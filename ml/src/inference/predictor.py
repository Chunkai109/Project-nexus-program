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

# Best-window search: rather than classifying the ENTIRE buffered live
# session as one repetition -- which makes however long the user takes
# between start_session()/end_session() directly determine "sequence_length"
# (the classifier's #1-importance feature) -- search sub-windows of the
# capture and report whichever one looks most like a good repetition. This
# makes live results insensitive to user tempo/pacing, by design: it reports
# the user's best rep-like segment within the capture rather than an average
# over the whole (possibly overlong) buffer. It does not change the model or
# its CV metric, and it does NOT apply to recorded-sequence replay
# (use_wallclock_duration=False), which keeps the original single-shot
# classification unchanged -- see _end_session_single_shot(). The duration
# grid below is deliberately a bit wider than training's own sequence_length
# range ([11, 86] frames @ ASSUMED_TRAINING_FPS = [0.46s, 3.58s], per
# feature_reference_stats.json) to allow slight margin.
WINDOW_MIN_SECONDS = 0.4
WINDOW_MAX_SECONDS = 4.0
WINDOW_DURATION_STEP = 0.25
WINDOW_STRIDE_FRACTION = 1.0 / 6.0


def _generate_candidate_windows(n_frames: int, live_fps: float) -> list[tuple[int, int]]:
    """Return (start, length) frame-index pairs to evaluate as candidate
    repetitions within a buffered live session: every plausible start offset
    for every window length spanning WINDOW_MIN_SECONDS..WINDOW_MAX_SECONDS
    (converted to frames via the estimated live capture fps), plus the whole
    buffer itself as one more candidate. `n_frames` must already be >=
    MIN_FRAMES_FOR_PREDICTION (checked by the caller).
    """
    candidates: set[tuple[int, int]] = {(0, n_frames)}
    durations = np.arange(WINDOW_MIN_SECONDS, WINDOW_MAX_SECONDS + 1e-9, WINDOW_DURATION_STEP)
    lengths = sorted({int(round(d * live_fps)) for d in durations})
    for raw_length in lengths:
        length = max(MIN_FRAMES_FOR_PREDICTION, min(raw_length, n_frames))
        if length > n_frames:
            continue
        stride = max(1, int(length * WINDOW_STRIDE_FRACTION))
        last_start = n_frames - length
        for start in range(0, last_start + 1, stride):
            candidates.add((start, length))
        if last_start >= 0:
            candidates.add((last_start, length))  # ensure the tail is covered even if stride overshoots
    return sorted(candidates)


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

        reference_path = model_dir / "feature_reference_stats.json"
        self.feature_reference = None
        if reference_path.exists():
            with open(reference_path) as f:
                self.feature_reference = json.load(f)

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

    def _check_rest_gate_batch(self, agg_batch: np.ndarray) -> np.ndarray:
        """Vectorized form of _check_rest_gate for a batch of candidate
        windows' aggregate feature rows -- same "below threshold on every
        gate feature" rejection rule, applied per row."""
        if self.rest_gate is None:
            return np.zeros(agg_batch.shape[0], dtype=bool)
        thresholds = self.rest_gate["rejection_thresholds"]
        reject = np.ones(agg_batch.shape[0], dtype=bool)
        for feat, thresh in thresholds.items():
            idx = AGGREGATE_FEATURE_NAMES.index(feat)
            reject &= agg_batch[:, idx] < thresh
        return reject

    def _feature_diagnostics(self, agg_by_name: dict, top_n: int = 6) -> list[dict]:
        """Z-score every engineered feature against the training (dev-pool)
        distribution and return the top_n most anomalous ones. This is what
        distinguishes "the model is unsure between two plausible classes"
        (all z-scores modest) from "this input doesn't resemble training
        data at all" (several large |z|) -- the actual diagnostic for a
        confidence problem, rather than guessing at architecture/data
        causes with no evidence from the live session itself.
        """
        if self.feature_reference is None:
            return []
        rows = []
        for feat, value in agg_by_name.items():
            ref = self.feature_reference.get(feat)
            if ref is None or ref["std"] == 0:
                continue
            z = (value - ref["mean"]) / ref["std"]
            rows.append({"feature": feat, "value": float(value), "z_score": float(z),
                         "training_mean": ref["mean"], "training_range": [ref["min"], ref["max"]]})
        rows.sort(key=lambda r: abs(r["z_score"]), reverse=True)
        return rows[:top_n]


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
        """Finish the buffered repetition and return the prediction.

        Live sessions (use_wallclock_duration=True, the default) search for
        the best-looking sub-window within everything buffered since
        start_session() -- see _end_session_with_window_search() -- so how
        long the user takes between 's' and 'e' does not by itself determine
        the result. Recorded-sequence replay (use_wallclock_duration=False,
        e.g. scripts/predict.py) keeps the original single-shot behavior,
        classifying the whole (already-correct-length) sequence as one unit.
        """
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

        duration_seconds = None
        if self._use_wallclock_duration and self._session_start_time is not None:
            duration_seconds = time.time() - self._session_start_time

        if self._use_wallclock_duration and duration_seconds:
            return self._end_session_with_window_search(feature_matrix, n_frames, duration_seconds)
        return self._end_session_single_shot(feature_matrix, n_frames, duration_seconds)

    def _classify_aggregate(self, agg_full: np.ndarray, n_frames: int, duration_seconds: float | None) -> dict:
        """Run the rest gate -> novelty check -> classify -> calibrate
        pipeline on a single already-built aggregate feature vector, and
        return the standard result dict. Shared by the single-shot path and
        (for the whole-session fallback only) the window-search path -- the
        window-search path's own per-candidate scoring is batched separately
        for speed, not routed through this one-row-at-a-time method.
        """
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

        novelty_score = None
        if self.novelty_detector is not None:
            novelty_score = float(self.novelty_detector.decision_function(agg_full.reshape(1, -1))[0])

        if novelty_score is not None and novelty_score < self.novelty_threshold:
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
                "novelty_score": novelty_score,
                "novelty_threshold": self.novelty_threshold,
                "feature_diagnostics": self._feature_diagnostics(agg_by_name),
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
            # Diagnostic fields -- if confidence/good_form_score looks wrong,
            # check these first: a low novelty_score close to (or past)
            # novelty_threshold, or large |z_score| values in
            # feature_diagnostics, means the live input's engineered
            # features don't resemble training data at all, which explains
            # near-chance-level confidence far better than "wrong model
            # architecture" would.
            "novelty_score": novelty_score,
            "novelty_threshold": self.novelty_threshold,
            "feature_diagnostics": self._feature_diagnostics(agg_by_name),
        }

    def _end_session_single_shot(self, feature_matrix: np.ndarray, n_frames: int,
                                  duration_seconds: float | None) -> dict:
        """Original behavior: classify the whole buffered sequence as one
        unit. Used for recorded-sequence replay (use_wallclock_duration=False),
        where the frame count is already correct and known -- unchanged by
        the addition of best-window search for live sessions."""
        agg_full = aggregate_sequence_features(feature_matrix)
        if self._use_wallclock_duration and duration_seconds is not None:
            equivalent_frames = duration_seconds * ASSUMED_TRAINING_FPS
            agg_full = agg_full.copy()
            agg_full[AGGREGATE_FEATURE_NAMES.index("sequence_length")] = equivalent_frames
        return self._classify_aggregate(agg_full, n_frames, duration_seconds)

    def _end_session_with_window_search(self, feature_matrix: np.ndarray, n_frames: int,
                                         duration_seconds: float) -> dict:
        """Live-session path: search sub-windows of the buffered capture and
        report whichever one looks most like a good repetition, so overall
        session duration/tempo does not by itself determine the result (see
        the WINDOW_* constants' docstring above). All candidate windows are
        scored in one batched pass for speed -- not one-by-one.
        """
        live_fps = (n_frames / duration_seconds) if duration_seconds > 0 else ASSUMED_TRAINING_FPS
        if live_fps <= 0:
            live_fps = ASSUMED_TRAINING_FPS

        candidates = _generate_candidate_windows(n_frames, live_fps)
        seq_len_idx = AGGREGATE_FEATURE_NAMES.index("sequence_length")

        agg_batch = np.empty((len(candidates), len(AGGREGATE_FEATURE_NAMES)), dtype=float)
        window_durations = np.empty(len(candidates), dtype=float)
        for i, (start, length) in enumerate(candidates):
            window = feature_matrix[start:start + length]
            agg = aggregate_sequence_features(window)
            window_duration = length / live_fps
            agg[seq_len_idx] = window_duration * ASSUMED_TRAINING_FPS
            agg_batch[i] = agg
            window_durations[i] = window_duration

        reject_rest = self._check_rest_gate_batch(agg_batch)

        if self.novelty_detector is not None:
            novelty_scores = self.novelty_detector.decision_function(agg_batch)
            passes_novelty = novelty_scores >= self.novelty_threshold
        else:
            novelty_scores = np.full(len(candidates), np.nan)
            passes_novelty = np.ones(len(candidates), dtype=bool)

        valid_mask = (~reject_rest) & passes_novelty
        whole_session_idx = candidates.index((0, n_frames))

        if not valid_mask.any():
            # Nothing in this capture resembles a recognizable curl at all --
            # fall back to the whole-session candidate's own gate outcome,
            # exactly matching pre-window-search behavior in this case.
            if reject_rest[whole_session_idx]:
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
            agg_by_name = dict(zip(AGGREGATE_FEATURE_NAMES, agg_batch[whole_session_idx]))
            whole_novelty = novelty_scores[whole_session_idx]
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
                "novelty_score": float(whole_novelty) if not np.isnan(whole_novelty) else None,
                "novelty_threshold": self.novelty_threshold,
                "feature_diagnostics": self._feature_diagnostics(agg_by_name),
                "num_frames": n_frames,
            }

        proba_batch = self.model.predict_proba(agg_batch[:, self._feature_idx])
        perfect_idx = CLASS_NAMES.index("Perfect")
        raw_good_form_scores = proba_batch[:, perfect_idx]

        masked_scores = np.where(valid_mask, raw_good_form_scores, -np.inf)
        best_idx = int(np.argmax(masked_scores))

        proba = proba_batch[best_idx]
        pred_idx = int(np.argmax(proba))
        raw_good_form_score = float(proba[perfect_idx])
        if self.good_form_anchor:
            good_form_score = min(1.0, raw_good_form_score / self.good_form_anchor)
        else:
            good_form_score = raw_good_form_score

        best_start, best_length = candidates[best_idx]
        agg_by_name = dict(zip(AGGREGATE_FEATURE_NAMES, agg_batch[best_idx]))
        best_novelty = novelty_scores[best_idx]

        return {
            "exercise": "bicep_curl",
            "prediction": CLASS_NAMES[pred_idx],
            "confidence": float(proba[pred_idx]),
            "good_form_score": good_form_score,
            "good_form_score_raw": raw_good_form_score,
            "class_probabilities": {c: float(p) for c, p in zip(CLASS_NAMES, proba)},
            "num_frames": best_length,
            "duration_seconds": float(window_durations[best_idx]),
            "novelty_score": float(best_novelty) if not np.isnan(best_novelty) else None,
            "novelty_threshold": self.novelty_threshold,
            "feature_diagnostics": self._feature_diagnostics(agg_by_name),
            # New: which part of the whole capture was selected, and how
            # exhaustively -- so a caller/demo can show the user which
            # segment of their (possibly much longer) capture was judged,
            # rather than this looking like a black box.
            "best_window_start_seconds": best_start / live_fps,
            "best_window_end_seconds": (best_start + best_length) / live_fps,
            "num_windows_evaluated": len(candidates),
            "total_capture_seconds": duration_seconds,
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
