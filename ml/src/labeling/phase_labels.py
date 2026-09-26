"""Derive rep-phase class labels for the bicep curl dataset.

The provided dataset has NO human-annotated performance/quality/correctness
labels -- only raw 3D mocap and a continuous, monotonically increasing
`rep_count` progress value designed for rep counting, not classification
(confirmed by inspection; see the project report). Per the project decision,
the classification target is instead the biomechanical phase of the curl
movement, derived directly and objectively from the working arm's own elbow
angle -- a standard, transparent heuristic-segmentation technique used
throughout human-activity-recognition research when no external phase
annotation exists. This is disclosed as a *derived* label, not ground truth
handed to us by the dataset.

Classes:
  bottom      - arm extended (near full elbow extension), holding/resting
  concentric  - curling up (elbow angle decreasing over time)
  top         - arm flexed (near full elbow flexion), holding/resting
  eccentric   - lowering down (elbow angle increasing over time)

Labeling uses full-sequence, non-causal (centered) smoothing because this is
building offline training targets from complete, already-recorded sequences
-- it is never used at inference time, so it may look slightly into the
future of the same recorded clip. Real-time inference only ever *predicts*
these classes (via the trained classifier in src/inference/predictor.py); it
never needs to compute them from a rule.

Thresholds (elbow-angle top/bottom cut points and the "near-zero velocity"
epsilon) are computed once from the pooled distribution across the whole
dataset and then frozen into label_config.json, so relabeling is
reproducible and the semantic meaning of each class is fixed.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict

import numpy as np

from ..preprocessing.normalize import joint_angle
from ..preprocessing import landmarks as lm

PHASE_NAMES = ["bottom", "concentric", "top", "eccentric"]


@dataclass
class LabelConfig:
    angle_top_threshold: float     # elbow angle (deg) at/below which arm counts as "top" (flexed)
    angle_bottom_threshold: float  # elbow angle (deg) at/above which arm counts as "bottom" (extended)
    velocity_epsilon: float        # |deg/frame| below which motion counts as "held" rather than moving
    smoothing_window: int = 9      # centered moving-average window (frames) used to build labels

    def to_dict(self):
        return asdict(self)


def _active_angle_series(normalized_coords_seq: list[np.ndarray]) -> np.ndarray:
    angles = np.zeros(len(normalized_coords_seq))
    for t, coords in enumerate(normalized_coords_seq):
        s = lm.get(coords, "right_shoulder")
        e = lm.get(coords, "right_elbow")
        w = lm.get(coords, "right_wrist")
        angles[t] = joint_angle(s, e, w)
    return angles


def _centered_moving_average(x: np.ndarray, window: int) -> np.ndarray:
    half = window // 2
    padded = np.pad(x, (half, half), mode="edge")
    kernel = np.ones(window) / window
    return np.convolve(padded, kernel, mode="valid")[: len(x)]


def _centered_velocity(x_smooth: np.ndarray) -> np.ndarray:
    v = np.zeros_like(x_smooth)
    v[1:-1] = (x_smooth[2:] - x_smooth[:-2]) / 2.0
    v[0] = x_smooth[1] - x_smooth[0]
    v[-1] = x_smooth[-1] - x_smooth[-2]
    return v


def fit_label_config(all_sequences_normalized_coords: list[list[np.ndarray]],
                      smoothing_window: int = 9,
                      top_pct: float = 15.0, bottom_pct: float = 85.0,
                      vel_eps_pct: float = 30.0) -> LabelConfig:
    """Compute frozen thresholds once, pooling smoothed angle/velocity values
    across every training sequence. Percentiles (not fixed hand-picked
    degrees) are used so the thresholds reflect this dataset's actual
    observed range of motion, while elbow angle in degrees is inherently
    subject/scale-invariant already (no per-subject renormalization needed).
    """
    all_angles_smooth = []
    all_abs_vel = []
    for seq in all_sequences_normalized_coords:
        angles = _active_angle_series(seq)
        smooth = _centered_moving_average(angles, smoothing_window)
        vel = _centered_velocity(smooth)
        all_angles_smooth.append(smooth)
        all_abs_vel.append(np.abs(vel))
    pooled_angles = np.concatenate(all_angles_smooth)
    pooled_abs_vel = np.concatenate(all_abs_vel)

    return LabelConfig(
        angle_top_threshold=float(np.percentile(pooled_angles, top_pct)),
        angle_bottom_threshold=float(np.percentile(pooled_angles, bottom_pct)),
        velocity_epsilon=float(np.percentile(pooled_abs_vel, vel_eps_pct)),
        smoothing_window=smoothing_window,
    )


def label_sequence(normalized_coords_seq: list[np.ndarray], config: LabelConfig) -> list[str]:
    angles = _active_angle_series(normalized_coords_seq)
    smooth = _centered_moving_average(angles, config.smoothing_window)
    vel = _centered_velocity(smooth)

    labels = []
    for a, v in zip(smooth, vel):
        if a <= config.angle_top_threshold:
            labels.append("top")
        elif a >= config.angle_bottom_threshold:
            labels.append("bottom")
        elif v < -config.velocity_epsilon:
            labels.append("concentric")
        elif v > config.velocity_epsilon:
            labels.append("eccentric")
        else:
            # Near-zero velocity in the mid-range (a brief pause mid-rep):
            # assign to whichever end of the range of motion is closer.
            mid = (config.angle_top_threshold + config.angle_bottom_threshold) / 2.0
            labels.append("top" if a < mid else "bottom")
    return labels
