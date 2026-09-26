"""Per-frame feature engineering, shared by training and inference.

After normalization (hip-centered, scale-normalized, handedness-canonicalized
-- see src/preprocessing/normalize.py), the "active" arm is always represented
by the *right*-side keypoints (left is the idle/supporting arm, mirrored in
if it was originally the working one). Every feature below is computed from
that canonical frame.

Feature set (7 values per frame) and why each one is here:

  elbow_angle_active     - instantaneous shoulder-elbow-wrist angle of the
                            working arm. The single most direct signal of
                            curl phase (small angle = flexed/top, large
                            angle = extended/bottom).
  elbow_angle_other       - same angle for the idle arm. Mostly near-constant,
                            but gives the model context to distinguish a real
                            phase transition from idle-arm noise/occlusion.
  wrist_height_active     - vertical position of the working wrist relative
                            to the shoulder (normalized). A second, largely
                            independent measurement of "how curled" the arm
                            is, using a different landmark pair -- adds
                            robustness if the elbow keypoint is briefly noisy.
  wrist_height_other      - same, idle arm, same rationale as elbow_angle_other.
  elbow_angle_active_vel  - short causal finite-difference velocity of the
                            working elbow angle. Sign distinguishes
                            concentric (flexing) from eccentric (extending)
                            motion at the same angle -- angle alone cannot.
  wrist_height_active_vel - velocity counterpart for wrist height.
  elbow_angle_active_rollstd - rolling standard deviation of the working
                            elbow angle over a short window. Captures
                            "how much is currently moving" independent of
                            direction, which helps separate held top/bottom
                            positions (near zero) from mid-range motion.

Explicitly NOT included: raw x/y pixel coordinates (would leak
camera framing/subject position despite normalization noise), hip/torso
lean, and joint-displacement magnitudes for non-arm joints -- none of these
carry information about curl phase and would only add noise for this
specific classification target.

All buffers are short (<=5 frames, i.e. <=~0.2s at 24fps) and strictly
causal, so the identical code runs online during live inference with low
latency, and offline during dataset preparation.
"""
from __future__ import annotations

from collections import deque

import numpy as np

from ..preprocessing import landmarks as lm
from ..preprocessing.normalize import joint_angle

FEATURE_NAMES = [
    "elbow_angle_active",
    "elbow_angle_other",
    "wrist_height_active",
    "wrist_height_other",
    "elbow_angle_active_vel",
    "wrist_height_active_vel",
    "elbow_angle_active_rollstd",
]
NUM_FEATURES = len(FEATURE_NAMES)


def _angle(coords: np.ndarray, side: str) -> float:
    s = lm.get(coords, f"{side}_shoulder")
    e = lm.get(coords, f"{side}_elbow")
    w = lm.get(coords, f"{side}_wrist")
    return joint_angle(s, e, w)


def _wrist_height(coords: np.ndarray, side: str) -> float:
    # In image coordinates y grows downward, so (shoulder_y - wrist_y) is
    # positive and larger the higher the wrist is raised relative to the
    # shoulder -- i.e. larger when more curled up.
    shoulder_y = lm.get(coords, f"{side}_shoulder")[1]
    wrist_y = lm.get(coords, f"{side}_wrist")[1]
    return float(shoulder_y - wrist_y)


class FeatureExtractor:
    """Causal, stateful per-frame feature extractor. Feed normalized frames
    (the `.coords` of a `NormalizedFrame` from SequenceNormalizer) one at a
    time, in order, via `.step()`.
    """

    def __init__(self, vel_window: int = 3, std_window: int = 5):
        self._angle_hist: deque[float] = deque(maxlen=vel_window)
        self._height_hist: deque[float] = deque(maxlen=vel_window)
        self._angle_std_hist: deque[float] = deque(maxlen=std_window)

    def step(self, coords: np.ndarray) -> np.ndarray:
        angle_active = _angle(coords, "right")   # canonical working arm
        angle_other = _angle(coords, "left")
        height_active = _wrist_height(coords, "right")
        height_other = _wrist_height(coords, "left")

        self._angle_hist.append(angle_active)
        self._height_hist.append(height_active)
        self._angle_std_hist.append(angle_active)

        angle_vel = self._causal_velocity(self._angle_hist)
        height_vel = self._causal_velocity(self._height_hist)
        angle_rollstd = float(np.std(self._angle_std_hist)) if len(self._angle_std_hist) > 1 else 0.0

        return np.array([
            angle_active, angle_other,
            height_active, height_other,
            angle_vel, height_vel,
            angle_rollstd,
        ], dtype=float)

    @staticmethod
    def _causal_velocity(hist: deque[float]) -> float:
        if len(hist) < 2:
            return 0.0
        vals = np.array(hist)
        # Average of consecutive frame-to-frame differences within the
        # short window -- a light causal smoothing of the instantaneous
        # velocity, cheap enough for real-time use.
        return float(np.mean(np.diff(vals)))


def extract_sequence_features(normalized_coords_seq: list[np.ndarray]) -> np.ndarray:
    """Convenience batch wrapper for dataset preparation: run a fresh causal
    FeatureExtractor over an already-normalized sequence (list of (17,3)
    arrays, in order) and return a (T, NUM_FEATURES) array.
    """
    extractor = FeatureExtractor()
    return np.stack([extractor.step(c) for c in normalized_coords_seq])
