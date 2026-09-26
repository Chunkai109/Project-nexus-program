"""Per-frame feature engineering, shared by training and inference.

Classes in this dataset (Perfect / Drag / Swing / Half / Heave) are named,
real bicep-curl form errors, so -- unlike a pure phase-detection problem --
features must capture more than just "how bent is the elbow": they need to
capture range of motion (Half = incomplete rep), torso/body movement
(Swing, Heave = using momentum from the body instead of the arm), and
elbow position stability (Drag = elbow drifting away from the torso).

After normalization (scale-normalized, handedness-canonicalized -- see
normalize.py), the working arm is always the canonical *right* side.

Feature set (8 values per frame):

  elbow_angle_active        - shoulder-elbow-wrist angle, working arm.
                               Direct range-of-motion signal -> targets "Half".
  elbow_angle_other         - same, idle arm. Context / sanity signal.
  wrist_height_active       - wrist height relative to shoulder, working arm.
                               Second, largely independent ROM measurement.
  torso_lean_angle          - angle of the shoulder-center-to-hip-center
                               vector from vertical. The hip is recentered
                               to (0,0,0) by MediaPipe's own world-landmark
                               convention, but *relative* shoulder position
                               still moves when the torso leans/sways, so
                               this is a real, non-trivial signal -> targets
                               "Swing"/"Heave" (using body momentum).
  elbow_forward_drift_active - horizontal (x) distance of the working elbow
                               from the hip-shoulder line. A curl with good
                               form keeps the elbow tucked at the side;
                               drift away from the torso is exactly what
                               "Drag" describes.
  elbow_angle_active_vel    - short causal velocity of the working elbow
                               angle. Captures tempo/jerkiness (rapid,
                               uneven motion is characteristic of heaving).
  wrist_height_active_vel   - velocity counterpart for wrist height.
  torso_lean_vel            - velocity of torso lean. A large, fast swing
                               shows up here even if the peak lean angle
                               is similar to a slower sway.

All buffers are short and strictly causal so the same code runs online
during live inference and offline during dataset preparation.
"""
from __future__ import annotations

from collections import deque

import numpy as np

from ..preprocessing import landmarks as lm
from ..preprocessing.normalize import joint_angle, hip_center, shoulder_center

FEATURE_NAMES = [
    "elbow_angle_active",
    "elbow_angle_other",
    "wrist_height_active",
    "torso_lean_angle",
    "elbow_forward_drift_active",
    "elbow_angle_active_vel",
    "wrist_height_active_vel",
    "torso_lean_vel",
]
NUM_FEATURES = len(FEATURE_NAMES)

# Raw normalized landmark subset used for the "raw landmarks" LSTM input
# channel (compared empirically against the engineered channel in training).
RAW_JOINTS = lm.CORE_JOINTS  # nose, L/R shoulder, L/R elbow, L/R wrist, L/R hip
RAW_DIM = len(RAW_JOINTS) * 3


def _angle(coords: np.ndarray, side: str) -> float:
    s = lm.get(coords, f"{side}_shoulder")
    e = lm.get(coords, f"{side}_elbow")
    w = lm.get(coords, f"{side}_wrist")
    return joint_angle(s, e, w)


def _wrist_height(coords: np.ndarray, side: str) -> float:
    shoulder_y = lm.get(coords, f"{side}_shoulder")[1]
    wrist_y = lm.get(coords, f"{side}_wrist")[1]
    return float(shoulder_y - wrist_y)


def _torso_lean_angle(coords: np.ndarray) -> float:
    hip = hip_center(coords)
    shoulder = shoulder_center(coords)
    vertical = shoulder - hip
    # angle between the torso vector and world-up (y axis in this dataset's
    # convention); 0 = perfectly upright.
    horiz = np.linalg.norm([vertical[0], vertical[2]])
    return float(np.degrees(np.arctan2(horiz, abs(vertical[1]) + 1e-8)))


def _elbow_forward_drift(coords: np.ndarray, side: str) -> float:
    hip = hip_center(coords)
    shoulder = shoulder_center(coords)
    elbow = lm.get(coords, f"{side}_elbow")
    # perpendicular horizontal (x) distance of the elbow from the hip-shoulder
    # line, in the coordinate frame's own x axis (left-right).
    torso_x = (hip[0] + shoulder[0]) / 2.0
    return float(elbow[0] - torso_x)


def raw_landmark_vector(coords: np.ndarray) -> np.ndarray:
    return np.concatenate([lm.get(coords, name) for name in RAW_JOINTS])


class FeatureExtractor:
    """Causal, stateful per-frame feature extractor."""

    def __init__(self, vel_window: int = 3):
        self._angle_hist: deque[float] = deque(maxlen=vel_window)
        self._height_hist: deque[float] = deque(maxlen=vel_window)
        self._lean_hist: deque[float] = deque(maxlen=vel_window)

    def step(self, coords: np.ndarray) -> np.ndarray:
        angle_active = _angle(coords, "right")
        angle_other = _angle(coords, "left")
        height_active = _wrist_height(coords, "right")
        lean = _torso_lean_angle(coords)
        drift_active = _elbow_forward_drift(coords, "right")

        self._angle_hist.append(angle_active)
        self._height_hist.append(height_active)
        self._lean_hist.append(lean)

        angle_vel = self._causal_velocity(self._angle_hist)
        height_vel = self._causal_velocity(self._height_hist)
        lean_vel = self._causal_velocity(self._lean_hist)

        return np.array([
            angle_active, angle_other, height_active, lean,
            drift_active, angle_vel, height_vel, lean_vel,
        ], dtype=float)

    @staticmethod
    def _causal_velocity(hist: deque[float]) -> float:
        if len(hist) < 2:
            return 0.0
        return float(np.mean(np.diff(np.array(hist))))


def extract_sequence_features(normalized_coords_seq: list[np.ndarray]) -> np.ndarray:
    """Run a fresh causal FeatureExtractor over an already-normalized
    sequence and return a (T, NUM_FEATURES) array."""
    extractor = FeatureExtractor()
    return np.stack([extractor.step(c) for c in normalized_coords_seq])


def extract_sequence_raw(normalized_coords_seq: list[np.ndarray]) -> np.ndarray:
    """Return the (T, RAW_DIM) raw-landmark-subset channel."""
    return np.stack([raw_landmark_vector(c) for c in normalized_coords_seq])


def aggregate_sequence_features(feature_matrix: np.ndarray) -> np.ndarray:
    """Collapse a (T, NUM_FEATURES) per-frame matrix into a fixed-length
    per-sequence summary vector for classical ML (RF/XGBoost): mean, std,
    min, max, and range of each engineered feature, plus sequence length.
    This is the "engineered sequence features" input Random Forest/XGBoost
    need (they cannot consume a variable-length raw sequence directly).
    """
    mean = feature_matrix.mean(axis=0)
    std = feature_matrix.std(axis=0)
    fmin = feature_matrix.min(axis=0)
    fmax = feature_matrix.max(axis=0)
    frange = fmax - fmin
    length = np.array([feature_matrix.shape[0]], dtype=float)
    return np.concatenate([mean, std, fmin, fmax, frange, length])


AGGREGATE_FEATURE_NAMES = (
    [f"{n}_mean" for n in FEATURE_NAMES]
    + [f"{n}_std" for n in FEATURE_NAMES]
    + [f"{n}_min" for n in FEATURE_NAMES]
    + [f"{n}_max" for n in FEATURE_NAMES]
    + [f"{n}_range" for n in FEATURE_NAMES]
    + ["sequence_length"]
)
