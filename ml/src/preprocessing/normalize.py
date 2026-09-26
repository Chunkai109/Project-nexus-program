"""Subject- and camera-invariant normalization, shared by training and inference.

The dataset's coordinates are already MediaPipe `pose_world_landmarks`:
metric (real-world-scale), hip-centered 3D positions (confirmed by
inspection -- the hip center sits at (0,0,0) every single frame, to
numerical noise). That removes absolute position for free. On top of that
we apply:

1. Scale normalization: divide by a running (causal) median shoulder-to-hip
   distance, so two subjects of different builds (or MediaPipe's own
   per-frame scale estimate wobbling slightly) produce comparable
   proportions. This is still needed even though the units are already
   "metric" -- MediaPipe's world-landmark scale is a proportion estimate,
   not a laser-measured body size.

2. Handedness canonicalization: this dataset's curl is performed one arm at
   a time (confirmed: ~88% of sequences show a clearly larger elbow
   range-of-motion on one side). Which arm is used has nothing to do with
   the quality label (Perfect/Drag/Swing/Half/Heave apply the same way to
   either arm), so we detect the higher-ROM arm and mirror left<->right
   when needed so the "working" arm is always presented on the same
   canonical side. This is the same normalization/augmentation-style
   technique used for the earlier dataset, re-applied here because it is
   independently justified by this dataset's own motion pattern, not
   carried over by default.

Implemented as a small causal, stateful class (`SequenceNormalizer`) fed one
frame at a time -- dataset preparation replays a whole recorded video
through it in order; live inference feeds it a real camera stream the exact
same way.
"""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass

import numpy as np

from . import landmarks as lm

EPS = 1e-6


def mid_point(frame: np.ndarray, name_a: str, name_b: str) -> np.ndarray:
    return (lm.get(frame, name_a) + lm.get(frame, name_b)) / 2.0


def hip_center(frame: np.ndarray) -> np.ndarray:
    return mid_point(frame, "left_hip", "right_hip")


def shoulder_center(frame: np.ndarray) -> np.ndarray:
    return mid_point(frame, "left_shoulder", "right_shoulder")


def torso_scale(frame: np.ndarray) -> float:
    return float(np.linalg.norm(shoulder_center(frame) - hip_center(frame)))


def joint_angle(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> float:
    """Angle at vertex `b` formed by points a-b-c, in degrees (3D)."""
    ba, bc = a - b, c - b
    denom = (np.linalg.norm(ba) * np.linalg.norm(bc)) + EPS
    cos_ang = np.dot(ba, bc) / denom
    return float(np.degrees(np.arccos(np.clip(cos_ang, -1.0, 1.0))))


def elbow_angle(frame: np.ndarray, side: str) -> float:
    s = lm.get(frame, f"{side}_shoulder")
    e = lm.get(frame, f"{side}_elbow")
    w = lm.get(frame, f"{side}_wrist")
    return joint_angle(s, e, w)


def mirror_frame(frame: np.ndarray, center_x: float) -> np.ndarray:
    """Mirror a (33,3) frame across the sagittal (x=center_x) plane and
    swap left/right-named keypoints. Only x flips -- y (vertical) and z
    (forward/back depth) are unaffected by a left-right mirror.
    """
    out = frame.copy()
    out[:, 0] = 2 * center_x - out[:, 0]
    for a, b in lm.MIRROR_PAIRS:
        ia, ib = lm.KP_INDEX[a], lm.KP_INDEX[b]
        out[[ia, ib]] = out[[ib, ia]]
    return out


@dataclass
class NormalizedFrame:
    coords: np.ndarray       # (33,3) scale-normalized, mirror-canonicalized
    scale: float
    active_side_raw: str     # 'left' or 'right'
    mirrored: bool


class SequenceNormalizer:
    def __init__(self, active_side: str | None = None,
                 scale_window: int = 30, rom_window: int = 90):
        self.forced_active_side = active_side
        self._scale_buf: deque[float] = deque(maxlen=scale_window)
        self._angle_buf = {"left": deque(maxlen=rom_window), "right": deque(maxlen=rom_window)}

    def _running_scale(self, frame: np.ndarray) -> float:
        raw = torso_scale(frame)
        if raw > EPS:
            self._scale_buf.append(raw)
        if not self._scale_buf:
            return 1.0
        return float(np.median(self._scale_buf))

    def _detect_active_side(self, frame: np.ndarray) -> str:
        if self.forced_active_side is not None:
            return self.forced_active_side
        self._angle_buf["left"].append(elbow_angle(frame, "left"))
        self._angle_buf["right"].append(elbow_angle(frame, "right"))
        if len(self._angle_buf["left"]) < 10:
            return "right"
        rom = {}
        for side in ("left", "right"):
            vals = np.array(self._angle_buf[side])
            lo, hi = np.percentile(vals, [5, 95])
            rom[side] = hi - lo
        return "left" if rom["left"] > rom["right"] else "right"

    def step(self, frame: np.ndarray) -> NormalizedFrame:
        active_side = self._detect_active_side(frame)
        scale = self._running_scale(frame)

        # Hip is already ~(0,0,0) in this dataset's world landmarks, but we
        # explicitly re-center anyway so the same code is correct for any
        # input that isn't already hip-centered. Frames here are pure
        # (33,3) x/y/z -- no separate visibility column.
        center = hip_center(frame)
        centered = (frame - center) / scale

        mirrored = active_side == "left"
        if mirrored:
            centered = mirror_frame(centered, center_x=0.0)

        return NormalizedFrame(coords=centered, scale=scale,
                                active_side_raw=active_side, mirrored=mirrored)
