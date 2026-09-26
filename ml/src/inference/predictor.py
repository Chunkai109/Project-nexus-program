"""Real-time inference pipeline for bicep-curl form classification.

Usage with a live MediaPipe Pose stream:

    predictor = BicepCurlPredictor()
    predictor.start_session()
    while camera_running:
        results = pose.process(frame)               # mediapipe.solutions.pose
        if results.pose_world_landmarks:             # NOTE: world landmarks, not
            predictor.add_frame(results.pose_world_landmarks)   # the default pose_landmarks
    result = predictor.end_session()
    # -> {"exercise": "bicep_curl", "prediction": "Perfect", "confidence": 0.91,
    #     "good_form_score": 0.91, "class_probabilities": {...}}

This is a whole-repetition classifier (the training labels are per-video,
not per-frame), so it is used in "session" style: start a session at the
beginning of a rep/set, feed every frame, then end the session to get one
prediction for that whole repetition -- mirroring exactly how the model was
trained (one label per complete curl sequence).

Every preprocessing step here (SequenceNormalizer, FeatureExtractor,
aggregate_sequence_features) is the exact same code imported from
src/preprocessing and src/features that scripts/prepare_dataset.py used to
build the training data -- there is no separate/duplicated inference-only
preprocessing logic.
"""
from __future__ import annotations

import json
from pathlib import Path

import joblib
import numpy as np

from ..preprocessing import landmarks as lm
from ..preprocessing.normalize import SequenceNormalizer
from ..features.engineer import FeatureExtractor, aggregate_sequence_features, AGGREGATE_FEATURE_NAMES
from ..models.labels import CLASS_NAMES

DEFAULT_MODEL_DIR = Path(__file__).resolve().parents[2] / "models" / "best_model"

MIN_FRAMES_FOR_PREDICTION = 10  # guards against a near-empty/aborted session


class BicepCurlPredictor:
    def __init__(self, model_dir: str | Path = DEFAULT_MODEL_DIR):
        model_dir = Path(model_dir)
        with open(model_dir / "training_config.json") as f:
            self.training_config = json.load(f)
        if self.training_config["overall_winner"] != "classical":
            raise NotImplementedError(
                "This predictor currently only wraps the classical (RandomForest/XGBoost) "
                "final model. The saved training_config.json reports a different winner; "
                "extend this class with an LSTM inference path (see scripts/evaluate.py's "
                "predict_lstm for the equivalent streaming logic) before using it."
            )
        self.model = joblib.load(model_dir / "model_classical.joblib")
        # Some trained models use a reduced feature subset (see
        # train.py's regularization/feature-selection search); fall back to
        # the full set for older training_config.json files that predate it.
        self.selected_features = self.training_config.get("selected_features", AGGREGATE_FEATURE_NAMES)
        self._feature_idx = [AGGREGATE_FEATURE_NAMES.index(c) for c in self.selected_features]

        gate_path = model_dir / "rest_gate_config.json"
        self.rest_gate = None
        if gate_path.exists():
            with open(gate_path) as f:
                self.rest_gate = json.load(f)

        self._normalizer: SequenceNormalizer | None = None
        self._extractor: FeatureExtractor | None = None
        self._per_frame_features: list[np.ndarray] = []
        self._active = False

    def _check_rest_gate(self, agg_by_name: dict) -> bool:
        """Return True if the session should be rejected as no_exercise_detected.

        See train.py's build_rest_gate_config() for how thresholds were
        derived: below-threshold on EVERY gate feature (not just one) means
        essentially no curling motion was detected in this session at all --
        the model has no class for that, so it is never asked to guess.
        """
        if self.rest_gate is None:
            return False
        thresholds = self.rest_gate["rejection_thresholds"]
        return all(agg_by_name[feat] < thresh for feat, thresh in thresholds.items())

    def start_session(self, active_side: str | None = None):
        """Begin buffering a new repetition/set.

        `active_side`: pass 'left' or 'right' if the app already knows which
        arm is working (e.g. the user selected it during calibration -- see
        frontend/src/pages/CalibrationPage.tsx for where that could plug in).
        Leave as None to auto-detect from the first ~10 frames' range of motion.
        """
        self._normalizer = SequenceNormalizer(active_side=active_side)
        self._extractor = FeatureExtractor()
        self._per_frame_features = []
        self._active = True

    def add_frame_from_world_landmarks(self, world_landmarks) -> None:
        """Feed one frame from MediaPipe's `pose_world_landmarks` result."""
        if not self._active:
            raise RuntimeError("call start_session() before add_frame_from_world_landmarks()")
        frame = lm.world_landmarks_to_frame(world_landmarks)
        self._add_frame_array(frame)

    def add_frame_from_array(self, frame: np.ndarray) -> None:
        """Feed one frame already as a (33, 3) array (x, y, z per MediaPipe
        Pose world landmark, in landmarks.MEDIAPIPE_LANDMARK_NAMES order) --
        used by scripts/predict.py to replay recorded CSV rows and by tests.
        """
        if not self._active:
            raise RuntimeError("call start_session() before add_frame_from_array()")
        self._add_frame_array(frame)

    def _add_frame_array(self, frame: np.ndarray) -> None:
        normalized = self._normalizer.step(frame)
        feats = self._extractor.step(normalized.coords)
        self._per_frame_features.append(feats)

    def num_frames_buffered(self) -> int:
        return len(self._per_frame_features)

    def end_session(self) -> dict:
        """Finish the buffered repetition and return the prediction."""
        if not self._active:
            raise RuntimeError("call start_session() before end_session()")
        self._active = False
        n_frames = len(self._per_frame_features)
        if n_frames < MIN_FRAMES_FOR_PREDICTION:
            return {
                "exercise": "bicep_curl",
                "prediction": None,
                "confidence": None,
                "error": f"only {n_frames} frames buffered (need >= {MIN_FRAMES_FOR_PREDICTION}); "
                         f"session too short to classify",
            }

        feature_matrix = np.stack(self._per_frame_features)
        agg_full = aggregate_sequence_features(feature_matrix)
        agg_by_name = dict(zip(AGGREGATE_FEATURE_NAMES, agg_full))

        if self._check_rest_gate(agg_by_name):
            return {
                "exercise": "bicep_curl",
                "prediction": "no_exercise_detected",
                "confidence": None,
                "message": (
                    "Little to no arm movement was detected during this session "
                    "(range of motion below the weakest real repetition on record "
                    "for every motion signal checked) -- this doesn't look like a "
                    "bicep curl, so no quality class was guessed."
                ),
                "num_frames": n_frames,
            }

        agg = agg_full[self._feature_idx].reshape(1, -1)
        proba = self.model.predict_proba(agg)[0]
        pred_idx = int(np.argmax(proba))
        perfect_idx = CLASS_NAMES.index("Perfect")

        return {
            "exercise": "bicep_curl",
            "prediction": CLASS_NAMES[pred_idx],
            "confidence": float(proba[pred_idx]),
            # good_form_score = P(Perfect), i.e. the 6-way distribution
            # collapsed into "looks correct" vs "looks like some kind of
            # error" for one intuitive per-rep number. This is NOT the same
            # thing as the model's own tested accuracy (see
            # training_config.json's "headline_generalization_metric",
            # ~88.5% CV macro-F1) -- that describes how reliable the model is
            # in general; this describes how good THIS ONE rep looked.
            "good_form_score": float(proba[perfect_idx]),
            "class_probabilities": {c: float(p) for c, p in zip(CLASS_NAMES, proba)},
            "num_frames": n_frames,
        }

    def predict_full_sequence(self, frames: np.ndarray, active_side: str | None = None) -> dict:
        """Convenience one-shot call for an already-complete sequence
        (T, 33, 3) array -- used by scripts/predict.py's demo."""
        self.start_session(active_side=active_side)
        for frame in frames:
            self._add_frame_array(frame)
        return self.end_session()
