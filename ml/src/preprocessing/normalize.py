"""Subject- and camera-invariant normalization, shared by training and inference.

Normalization strategy (see the project report for the full justification):

1. Translation: every frame is re-centered on the mid-hip point. This removes
   the person's absolute position in the frame / distance from the left edge
   etc. -- a model must not learn "where in the image" someone stands.

2. Scale: coordinates are divided by a running (causal) median of the
   shoulder-to-hip distance. This removes body size and camera-distance
   effects: a tall subject filmed close up and a short subject filmed far
   away produce the same normalized geometry. The estimate is causal
   (computed only from frames seen so far) so the exact same code path can
   run on a live camera stream frame-by-frame, not just on complete,
   already-recorded sequences.

3. Handedness canonicalization ("mirroring"): this dataset's dumbbell curl is
   performed one arm at a time, and which arm is used is not semantically
   meaningful (it's not part of "exercise quality/phase") -- a curl is a
   curl whichever arm does it. We detect which arm has the larger elbow
   range-of-motion and, if it is the left arm, mirror the frame
   left<->right so the "working" arm is always presented to the model on
   the same canonical side. This directly implements the "mirroring
   left/right where semantically valid" normalization/augmentation the
   project spec calls for, and shrinks what the model has to learn.

All of this is implemented as a small stateful class (`SequenceNormalizer`)
fed one frame at a time, in order, via `.step()`. Dataset preparation feeds
it an entire recorded sequence frame by frame (simulating a live stream);
`src/inference/predictor.py` feeds it live MediaPipe frames the exact same
way. There is no separate "batch" normalization code path.
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
    """Shoulder-center to hip-center distance for one frame -- the raw
    (noisy, single-frame) body-size reference used to build a smoothed,
    causal running estimate in SequenceNormalizer.
    """
    d = shoulder_center(frame) - hip_center(frame)
    return float(np.linalg.norm(d))


def joint_angle(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> float:
    """Angle at vertex `b` formed by points a-b-c, in degrees."""
    ba = a - b
    bc = c - b
    denom = (np.linalg.norm(ba) * np.linalg.norm(bc)) + EPS
    cos_ang = np.dot(ba, bc) / denom
    return float(np.degrees(np.arccos(np.clip(cos_ang, -1.0, 1.0))))


def elbow_angle(frame: np.ndarray, side: str) -> float:
    """Shoulder-elbow-wrist angle in degrees for 'left' or 'right'."""
    s = lm.get(frame, f"{side}_shoulder")
    e = lm.get(frame, f"{side}_elbow")
    w = lm.get(frame, f"{side}_wrist")
    return joint_angle(s, e, w)


def mirror_frame(frame: np.ndarray, center_x: float) -> np.ndarray:
    """Mirror a (17,3) frame horizontally about `center_x` and swap
    left/right-named keypoints so the array stays semantically consistent
    (index for "left_elbow" still holds whichever elbow is anatomically
    left after the flip).
    """
    out = frame.copy()
    out[:, 0] = 2 * center_x - out[:, 0]
    for a, b in lm.MIRROR_PAIRS:
        ia, ib = lm.KP_INDEX[a], lm.KP_INDEX[b]
        out[[ia, ib]] = out[[ib, ia]]
    return out


@dataclass
class NormalizedFrame:
    coords: np.ndarray       # (17,3) hip-centered, scale-normalized, mirror-canonicalized
    scale: float             # running scale estimate used
    active_side_raw: str     # 'left' or 'right' -- which raw side was detected as active
    mirrored: bool           # whether this frame was flipped to canonicalize


class SequenceNormalizer:
    """Causal, stateful normalizer. Call `.step(frame)` once per incoming
    frame, in temporal order, for both dataset preparation (replaying a
    recorded sequence) and live inference (a real camera stream).
    """

    def __init__(self, active_side: str | None = None,
                 scale_window: int = 30, rom_window: int = 90):
        # `active_side`: pass 'left'/'right' to force a known working arm
        # (e.g. the user selected it during app calibration). None = auto-detect.
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
            # Cold start: not enough history to judge range of motion yet.
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

        center = hip_center(frame)
        centered = frame.copy()
        centered[:, :2] = (centered[:, :2] - center) / scale

        mirrored = active_side == "left"
        if mirrored:
            centered = mirror_frame(centered, center_x=0.0)

        return NormalizedFrame(coords=centered, scale=scale,
                                active_side_raw=active_side, mirrored=mirrored)
