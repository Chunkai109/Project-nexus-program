"""Canonical landmark representation shared by training data and live MediaPipe input.

The PhysioVision dataset (`reduced.csv`) stores, per frame, columns
x0..x32, y0..y32, z0..z32 -- these are exactly MediaPipe Pose's 33
standard landmarks, in MediaPipe's own index order, and (confirmed by
inspection: left_hip/right_hip average to ~(0,0,0) with near-zero
per-frame variance) in **world-landmark** space: metric, hip-centered
3D coordinates, not the default normalized-image-plane landmarks.

That means live inference MUST read `pose_world_landmarks` from MediaPipe
Pose (not the default `pose_landmarks`) to match the training distribution.
This module defines that shared (33, 3) representation and the two thin
adapters (CSV row <-> live MediaPipe result) that build it, so every
downstream module (normalize.py, features/engineer.py, inference/predictor.py)
operates on identical data regardless of source.
"""
from __future__ import annotations

import numpy as np

# Standard MediaPipe Pose landmark order (mediapipe.solutions.pose.PoseLandmark).
MEDIAPIPE_LANDMARK_NAMES = [
    "nose", "left_eye_inner", "left_eye", "left_eye_outer",
    "right_eye_inner", "right_eye", "right_eye_outer",
    "left_ear", "right_ear", "mouth_left", "mouth_right",
    "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
    "left_wrist", "right_wrist", "left_pinky", "right_pinky",
    "left_index", "right_index", "left_thumb", "right_thumb",
    "left_hip", "right_hip", "left_knee", "right_knee",
    "left_ankle", "right_ankle", "left_heel", "right_heel",
    "left_foot_index", "right_foot_index",
]
KP_INDEX = {name: i for i, name in enumerate(MEDIAPIPE_LANDMARK_NAMES)}
NUM_KEYPOINTS = len(MEDIAPIPE_LANDMARK_NAMES)  # 33

MIRROR_PAIRS = [
    ("left_eye_inner", "right_eye_inner"), ("left_eye", "right_eye"),
    ("left_eye_outer", "right_eye_outer"), ("left_ear", "right_ear"),
    ("mouth_left", "mouth_right"),
    ("left_shoulder", "right_shoulder"), ("left_elbow", "right_elbow"),
    ("left_wrist", "right_wrist"), ("left_pinky", "right_pinky"),
    ("left_index", "right_index"), ("left_thumb", "right_thumb"),
    ("left_hip", "right_hip"), ("left_knee", "right_knee"),
    ("left_ankle", "right_ankle"), ("left_heel", "right_heel"),
    ("left_foot_index", "right_foot_index"),
]

# The reduced feature subset actually used downstream (arms + shoulders +
# hips + nose) -- everything needed for elbow angles, wrist height and
# torso lean, without hand/eye/foot detail this exercise doesn't need.
CORE_JOINTS = [
    "nose", "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
    "left_wrist", "right_wrist", "left_hip", "right_hip",
]


def row_to_frame(row) -> np.ndarray:
    """Build a (33, 3) array from one row of the training CSV (a pandas
    Series or dict-like with x{i}/y{i}/z{i} columns)."""
    out = np.zeros((NUM_KEYPOINTS, 3), dtype=float)
    for i in range(NUM_KEYPOINTS):
        out[i, 0] = row[f"x{i}"]
        out[i, 1] = row[f"y{i}"]
        out[i, 2] = row[f"z{i}"]
    return out


def frames_from_dataframe(df) -> np.ndarray:
    """Vectorized equivalent of calling row_to_frame on every row of a
    dataframe (already sorted in the desired frame order): returns
    (num_rows, 33, 3).
    """
    cols = [f"{axis}{i}" for i in range(NUM_KEYPOINTS) for axis in ("x", "y", "z")]
    return df[cols].to_numpy(dtype=float).reshape(len(df), NUM_KEYPOINTS, 3)


def world_landmarks_to_frame(world_landmarks) -> np.ndarray:
    """Build a (33, 3) array from a live MediaPipe `pose_world_landmarks`
    result (an object with a `.landmark` list of 33 entries, each with
    .x/.y/.z in meters, hip-centered -- NOT the default normalized
    `pose_landmarks`)."""
    lm_list = world_landmarks.landmark if hasattr(world_landmarks, "landmark") else world_landmarks
    out = np.zeros((NUM_KEYPOINTS, 3), dtype=float)
    for i, lm in enumerate(lm_list):
        out[i] = (lm.x, lm.y, lm.z)
    return out


def get(frame: np.ndarray, name: str) -> np.ndarray:
    return frame[KP_INDEX[name], :3]
