"""Per-rep aggregate feature engineering for the wearable IMU/EMG device.

Analogous in spirit to ml/src/features/engineer.py::aggregate_sequence_features,
but built directly on this device's own 4 raw channels -- there is no
elbow-angle/torso-lean geometry to compute here, the device already outputs
`flex` (bend-sensor elbow-flexion proxy) and `drift` (gyro-derived secondary
angle) directly.
"""
from __future__ import annotations

import numpy as np

FEATURE_NAMES = [
    "flex_mean", "flex_std", "flex_min", "flex_max", "flex_range",
    "drift_mean", "drift_std", "drift_min", "drift_max", "drift_range",
    "emg_mean", "emg_std", "emg_max",
    "vib_on_frac",
    "flex_vel_mean", "flex_vel_std",
    "drift_vel_mean", "drift_vel_std",
    "num_frames",
]


def _causal_velocity_series(x: np.ndarray) -> np.ndarray:
    """First-difference velocity, same style as
    FeatureExtractor._causal_velocity in the vision code."""
    if len(x) < 2:
        return np.array([0.0])
    return np.diff(x)


def extract_rep_features(flex: np.ndarray, drift: np.ndarray, emg: np.ndarray,
                          vib_on: np.ndarray) -> np.ndarray:
    """Aggregate one rep's raw per-frame arrays into a fixed-length feature
    vector, in FEATURE_NAMES order."""
    flex_vel = _causal_velocity_series(flex)
    drift_vel = _causal_velocity_series(drift)

    return np.array([
        flex.mean(), flex.std(), flex.min(), flex.max(), flex.max() - flex.min(),
        drift.mean(), drift.std(), drift.min(), drift.max(), drift.max() - drift.min(),
        emg.mean(), emg.std(), emg.max(),
        vib_on.mean(),
        flex_vel.mean(), flex_vel.std(),
        drift_vel.mean(), drift_vel.std(),
        float(len(flex)),
    ], dtype=float)
