"""Minimal inference wrapper for the IMU/EMG classifier.

Unlike ml/src/inference/predictor.py's BicepCurlPredictor, there is no
live-streaming/session-buffering complexity here: no webcam loop, no
wall-clock-duration FPS concerns (this device logs at its own fixed rate,
and every use case so far is replaying an already-complete recorded rep).
A "session" is just a fixed array handed in all at once.

Includes the same two-piece novelty-detection pattern as the vision
model's predictor (IsolationForest gate + feature z-score diagnostics),
added because this classifier's "knowledge" is really just one person's
narrow sensor range -- see ml_imu/README.md and
models/best_model/novelty_detector_config.json's caveat for why this
threshold is a coarser, unvalidated floor compared to the vision model's.
"""
from __future__ import annotations

import json
from pathlib import Path

import joblib
import numpy as np

from .features import extract_rep_features, FEATURE_NAMES
from .labels import CLASS_NAMES

DEFAULT_MODEL_DIR = Path(__file__).resolve().parents[1] / "models" / "best_model"


class ImuCurlPredictor:
    def __init__(self, model_dir: str | Path = DEFAULT_MODEL_DIR):
        model_dir = Path(model_dir)
        self.model = joblib.load(model_dir / "model.joblib")
        with open(model_dir / "training_config.json") as f:
            self.training_config = json.load(f)

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

    def _feature_diagnostics(self, feats: np.ndarray, top_n: int = 6) -> list[dict]:
        """Z-score every engineered feature against this dataset's own
        mean/std and return the top_n most anomalous ones -- same purpose
        as the vision predictor's identically-named method: distinguish
        "unsure between classes" from "this input doesn't resemble the
        training data at all"."""
        if self.feature_reference is None:
            return []
        rows = []
        for name, value in zip(FEATURE_NAMES, feats):
            ref = self.feature_reference.get(name)
            if ref is None or ref["std"] == 0:
                continue
            z = (float(value) - ref["mean"]) / ref["std"]
            rows.append({"feature": name, "value": float(value), "z_score": float(z),
                         "training_mean": ref["mean"], "training_range": [ref["min"], ref["max"]]})
        rows.sort(key=lambda r: abs(r["z_score"]), reverse=True)
        return rows[:top_n]

    def predict_from_arrays(self, flex: np.ndarray, drift: np.ndarray,
                             emg: np.ndarray, vib_on: np.ndarray) -> dict:
        """Classify one already-complete, already-recorded rep. Runs the
        novelty gate first -- if the input doesn't statistically resemble
        anything in the 52-row training set, returns 'unrecognized_input'
        instead of forcing a guess among the 4 known classes."""
        feats = extract_rep_features(flex, drift, emg, vib_on)
        feats_2d = feats.reshape(1, -1)

        novelty_score = None
        if self.novelty_detector is not None:
            novelty_score = float(self.novelty_detector.decision_function(feats_2d)[0])

        if novelty_score is not None and novelty_score < self.novelty_threshold:
            return {
                "exercise": "bicep_curl",
                "prediction": "unrecognized_input",
                "confidence": None,
                "message": (
                    "This input's sensor signature doesn't statistically resemble "
                    "anything in the 52-row training set (any of the 4 known "
                    "classes) -- could be a different person's device fit/"
                    "calibration, a different exercise, or a sensor issue. No "
                    "quality class was guessed. Note: this detector's threshold "
                    "is a coarse, unvalidated floor (no held-out data existed to "
                    "tune it) -- see novelty_detector_config.json's caveat."
                ),
                "novelty_score": novelty_score,
                "novelty_threshold": self.novelty_threshold,
                "feature_diagnostics": self._feature_diagnostics(feats),
                "num_frames": len(flex),
            }

        proba = self.model.predict_proba(feats_2d)[0]
        pred_idx = int(np.argmax(proba))
        return {
            "exercise": "bicep_curl",
            "prediction": CLASS_NAMES[pred_idx],
            "confidence": float(proba[pred_idx]),
            "class_probabilities": {c: float(p) for c, p in zip(CLASS_NAMES, proba)},
            "num_frames": len(flex),
            "novelty_score": novelty_score,
            "novelty_threshold": self.novelty_threshold,
            "feature_diagnostics": self._feature_diagnostics(feats),
        }
