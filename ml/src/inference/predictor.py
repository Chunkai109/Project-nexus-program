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
import time
from pathlib import Path

import joblib
import numpy as np

from ..preprocessing import landmarks as lm
from ..preprocessing.normalize import SequenceNormalizer
from ..features.engineer import FeatureExtractor, aggregate_sequence_features, AGGREGATE_FEATURE_NAMES
from ..models.labels import CLASS_NAMES

DEFAULT_MODEL_DIR = Path(__file__).resolve().parents[2] / "models" / "best_model"

MIN_FRAMES_FOR_PREDICTION = 10  # guards against a near-empty/aborted session

# "sequence_length" is the classifier's #1 feature (it's how "Incomplete" is
# largely recognized -- a truncated rep has fewer frames). The training data
# only has frame_number, no timestamps, so its features were built from raw
# frame COUNT under whatever fps the original clips were captured at
# (undocumented, unknown). A live webcam's processing rate is very unlikely
# to match that: a faster/slower capture+inference loop would make raw frame
# count reflect processing speed, not how long the rep actually took. To
# keep the two comparable, live sessions measure real wall-clock duration
# and convert it to an EQUIVALENT frame count at this assumed reference fps,
# rather than using the raw number of frames MediaPipe happened to process.
# This is a documented guess, not verified ground truth (~71 frames average
# for a normal-paced rep in training / ~3s for a deliberate curl repetition
# implies something in the 20-30fps range; 24fps is a common recording
# default) -- tune ASSUMED_TRAINING_FPS if live behavior suggests otherwise.
ASSUMED_TRAINING_FPS = 24.0


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

        calibration_path = model_dir / "good_form_calibration.json"
        self.good_form_anchor = None
        if calibration_path.exists():
            with open(calibration_path) as f:
                self.good_form_anchor = json.load(f)["anchor_p_perfect"]

        novelty_path = model_dir / "novelty_detector.joblib"
        novelty_config_path = model_dir / "novelty_detector_config.json"
        self.novelty_detector = None
        self.novelty_threshold = None
        if novelty_path.exists() and novelty_config_path.exists():
            self.novelty_detector = joblib.load(novelty_path)
            with open(novelty_config_path) as f:
                self.novelty_threshold = json.load(f)["threshold"]

        self._normalizer: SequenceNormalizer | None = None
        self._extractor: FeatureExtractor | None = None
        self._per_frame_features: list[np.ndarray] = []
        self._active = False
        self._session_start_time: float | None = None
        self._use_wallclock_duration = True

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

    def _check_novelty(self, agg_full: np.ndarray) -> bool:
        """Return True if this session's full feature profile doesn't
        statistically resemble any real curl (see train.py's
        build_novelty_detector()) -- catches non-curl movement that has real
        motion (so the rest gate wouldn't catch it), e.g. a different
        exercise or arbitrary arm movement.
        """
        if self.novelty_detector is None:
            return False
        score = self.novelty_detector.decision_function(agg_full.reshape(1, -1))[0]
        return score < self.novelty_threshold

    def start_session(self, active_side: str | None = None, use_wallclock_duration: bool = True):
        """Begin buffering a new repetition/set.

        `active_side`: pass 'left' or 'right' if the app already knows which
        arm is working (e.g. the user selected it during calibration -- see
        frontend/src/pages/CalibrationPage.tsx for where that could plug in).
        Leave as None to auto-detect from the first ~10 frames' range of motion.

        `use_wallclock_duration`: True (the live-camera default) measures
        real elapsed seconds and uses that (converted via
        ASSUMED_TRAINING_FPS) for the "sequence_length" feature instead of
        the raw number of processed frames, since a live loop's processing
        rate has no reason to match the training data's capture rate. Set to
        False when replaying already-recorded frames with known, correct
        frame semantics (predict_full_sequence() below does this).
        """
        self._normalizer = SequenceNormalizer(active_side=active_side)
        self._extractor = FeatureExtractor()
        self._per_frame_features = []
        self._active = True
        self._session_start_time = time.time()
        self._use_wallclock_duration = use_wallclock_duration

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

        duration_seconds = None
        if self._use_wallclock_duration and self._session_start_time is not None:
            duration_seconds = time.time() - self._session_start_time
            equivalent_frames = duration_seconds * ASSUMED_TRAINING_FPS
            agg_full = agg_full.copy()
            agg_full[AGGREGATE_FEATURE_NAMES.index("sequence_length")] = equivalent_frames

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

        if self._check_novelty(agg_full):
            return {
                "exercise": "bicep_curl",
                "prediction": "unrecognized_movement",
                "confidence": None,
                "message": (
                    "Real movement was detected, but its overall pattern doesn't "
                    "statistically resemble any bicep curl seen in training (any "
                    "quality) -- this looks like a different exercise or unrelated "
                    "movement, so no quality class was guessed."
                ),
                "num_frames": n_frames,
            }

        agg = agg_full[self._feature_idx].reshape(1, -1)
        proba = self.model.predict_proba(agg)[0]
        pred_idx = int(np.argmax(proba))
        perfect_idx = CLASS_NAMES.index("Perfect")
        raw_good_form_score = float(proba[perfect_idx])

        # RandomForest's predict_proba is a vote fraction across shallow
        # trees, so raw P(Perfect) tops out around ~0.61 even for the best
        # real "Perfect" example on record -- displaying that raw number as
        # a 0-100% scale reads as mediocre for what is actually excellent
        # form. good_form_calibration.json (see train.py's
        # build_good_form_calibration()) rescales it so the best rep on
        # record reads as ~100%; this is a monotonic DISPLAY-only stretch,
        # it never changes which class was predicted or which rep ranks
        # higher than which other rep. Falls back to the raw value if no
        # calibration file exists (older training_config.json).
        if self.good_form_anchor:
            good_form_score = min(1.0, raw_good_form_score / self.good_form_anchor)
        else:
            good_form_score = raw_good_form_score

        return {
            "exercise": "bicep_curl",
            "prediction": CLASS_NAMES[pred_idx],
            "confidence": float(proba[pred_idx]),
            # good_form_score = calibrated P(Perfect) -- the 6-way
            # distribution collapsed into "looks correct" vs "looks like
            # some kind of error" for one intuitive per-rep number, rescaled
            # for display (see good_form_score_raw for the uncalibrated
            # value). This is NOT the same thing as the model's own tested
            # accuracy (see training_config.json's
            # "headline_generalization_metric", ~88.5% CV macro-F1) -- that
            # describes how reliable the model is in general; this describes
            # how good THIS ONE rep looked.
            "good_form_score": good_form_score,
            "good_form_score_raw": raw_good_form_score,
            "class_probabilities": {c: float(p) for c, p in zip(CLASS_NAMES, proba)},
            "num_frames": n_frames,
            "duration_seconds": duration_seconds,
        }

    def predict_full_sequence(self, frames: np.ndarray, active_side: str | None = None) -> dict:
        """Convenience one-shot call for an already-complete, already-recorded
        sequence (T, 33, 3) array -- used by scripts/predict.py's demo.
        Explicitly disables wall-clock duration timing (use_wallclock_duration=False):
        these frames are replayed from a CSV in a tight loop, not paced in
        real time, so elapsed wall-clock time here is meaningless -- the raw
        frame count IS the correct value, exactly as used when this same
        sequence was featurized for training.
        """
        self.start_session(active_side=active_side, use_wallclock_duration=False)
        for frame in frames:
            self._add_frame_array(frame)
        return self.end_session()
