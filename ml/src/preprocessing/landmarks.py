"""Canonical landmark representation shared by training data and live MediaPipe input.

Both the training dataset (COCO-style keypoints baked into the provided JSON
files) and a live MediaPipe Pose stream are converted into the *same*
(17, 3) array of (x, y, visibility) before anything else happens. Every
downstream module (normalize.py, engineer.py, phase_labels.py,
inference/predictor.py) only ever sees this canonical array, which is what
guarantees training and real-time inference run identical code.
"""
from __future__ import annotations

import numpy as np

# Order matches the `categories[0]["keypoints"]` list in the provided
# dataset's JSON files exactly, and is a strict subset of MediaPipe Pose's
# 33 landmarks.
COCO17_NAMES = [
    "nose", "left_eye", "right_eye", "left_ear", "right_ear",
    "left_shoulder", "right_shoulder",
    "left_elbow", "right_elbow",
    "left_wrist", "right_wrist",
    "left_hip", "right_hip",
    "left_knee", "right_knee",
    "left_ankle", "right_ankle",
]
KP_INDEX = {name: i for i, name in enumerate(COCO17_NAMES)}
NUM_KEYPOINTS = len(COCO17_NAMES)

# Standard MediaPipe Pose landmark indices (mediapipe.solutions.pose.PoseLandmark)
# for the subset of joints that overlap with COCO17, in COCO17 order. Using the
# raw integer indices here means this module has no hard dependency on the
# `mediapipe` package itself -- it only needs objects with .x/.y/.visibility.
MEDIAPIPE_INDEX_FOR_COCO17 = [
    0,   # nose
    2,   # left_eye
    5,   # right_eye
    7,   # left_ear
    8,   # right_ear
    11,  # left_shoulder
    12,  # right_shoulder
    13,  # left_elbow
    14,  # right_elbow
    15,  # left_wrist
    16,  # right_wrist
    23,  # left_hip
    24,  # right_hip
    25,  # left_knee
    26,  # right_knee
    27,  # left_ankle
    28,  # right_ankle
]

# Keypoint name pairs that must be swapped when a frame is mirrored
# left<->right (used by normalize.py to canonicalize the "active" arm).
MIRROR_PAIRS = [
    ("left_eye", "right_eye"), ("left_ear", "right_ear"),
    ("left_shoulder", "right_shoulder"), ("left_elbow", "right_elbow"),
    ("left_wrist", "right_wrist"), ("left_hip", "right_hip"),
    ("left_knee", "right_knee"), ("left_ankle", "right_ankle"),
]


def keypoints_from_coco_annotation(flat_keypoints: list[float]) -> np.ndarray:
    """Convert a COCO-style flat [x,y,v, x,y,v, ...] list (17*3 long, as
    stored in the dataset's `annotations[i]['keypoints']` field) into a
    (17, 3) array in canonical COCO17_NAMES order.
    """
    arr = np.asarray(flat_keypoints, dtype=float).reshape(-1, 3)
    if arr.shape[0] != NUM_KEYPOINTS:
        raise ValueError(f"expected {NUM_KEYPOINTS} keypoints, got {arr.shape[0]}")
    return arr


def keypoints_from_mediapipe(landmarks, image_width: float, image_height: float) -> np.ndarray:
    """Convert a live MediaPipe Pose result's landmark list (33 entries with
    normalized .x/.y in [0,1] and .visibility) into the same (17, 3) pixel-space
    array used by the training pipeline.

    `image_width`/`image_height` are the pixel dimensions of the frame the
    landmarks were detected on -- required because MediaPipe reports x, y as
    fractions of width/height respectively, and our normalization pipeline
    needs both axes on a consistent pixel scale (see normalize.py).
    """
    out = np.zeros((NUM_KEYPOINTS, 3), dtype=float)
    for coco_i, mp_i in enumerate(MEDIAPIPE_INDEX_FOR_COCO17):
        lm = landmarks[mp_i]
        out[coco_i, 0] = lm.x * image_width
        out[coco_i, 1] = lm.y * image_height
        out[coco_i, 2] = getattr(lm, "visibility", 1.0)
    return out


def get(frame: np.ndarray, name: str) -> np.ndarray:
    """Return the (x, y) position of a named keypoint in a (17,3) frame."""
    return frame[KP_INDEX[name], :2]


def visibility(frame: np.ndarray, name: str) -> float:
    return float(frame[KP_INDEX[name], 2])
