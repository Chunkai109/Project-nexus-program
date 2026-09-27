"""Minimal inference wrapper for the IMU/EMG classifier.

Unlike ml/src/inference/predictor.py's BicepCurlPredictor, there is no
live-streaming/session-buffering complexity here: no webcam loop, no
wall-clock-duration FPS concerns (this device logs at its own fixed rate,
and every use case so far is replaying an already-complete recorded rep).
A "session" is just a fixed array handed in all at once.
"""
from __future__ import annotations

import json
from pathlib import Path

import joblib
import numpy as np

from .features import extract_rep_features
from .labels import CLASS_NAMES

DEFAULT_MODEL_DIR = Path(__file__).resolve().parents[1] / "models" / "best_model"


class ImuCurlPredictor:
    def __init__(self, model_dir: str | Path = DEFAULT_MODEL_DIR):
        model_dir = Path(model_dir)
        self.model = joblib.load(model_dir / "model.joblib")
        with open(model_dir / "training_config.json") as f:
            self.training_config = json.load(f)

    def predict_from_arrays(self, flex: np.ndarray, drift: np.ndarray,
                             emg: np.ndarray, vib_on: np.ndarray) -> dict:
        """Classify one already-complete, already-recorded rep."""
        feats = extract_rep_features(flex, drift, emg, vib_on).reshape(1, -1)
        proba = self.model.predict_proba(feats)[0]
        pred_idx = int(np.argmax(proba))
        return {
            "exercise": "bicep_curl",
            "prediction": CLASS_NAMES[pred_idx],
            "confidence": float(proba[pred_idx]),
            "class_probabilities": {c: float(p) for c, p in zip(CLASS_NAMES, proba)},
            "num_frames": len(flex),
        }
