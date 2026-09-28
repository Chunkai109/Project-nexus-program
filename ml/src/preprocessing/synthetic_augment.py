"""Extra synthetic augmentation for the TRAIN split only.

Direct analysis of this dataset's pre-generated `_aug_0`..`_aug_9` copies
(see dataset_io.py's module docstring for the leakage-relevant parts, and
ml/README.md's "Synthetic augmentation of the training split" section for
the full characterization) found they vary exactly three things: uniform
playback speed (~0.79-1.19x), a single uniform body-scale factor about the
hip (~0.89-1.05x, same for every landmark within one copy), and small
additive per-coordinate noise (std ~0.013-0.02m). They never vary camera
viewing angle (rotation) or non-uniform tempo (e.g. a faster concentric
than eccentric phase). This module adds exactly those two missing kinds of
variation, and only that -- it is deliberately narrow in scope.

IMPORTANT -- this is a mitigation, not a fix: it increases synthetic
diversity of the same real performances that were already in the training
set. It does not add independent new information about bicep-curl form,
and a rigid rotation of already-reconstructed 3D landmarks is not the same
as re-filming from a different angle and re-running MediaPipe's own
angle-dependent pose estimator on it -- it cannot capture real
angle-dependent estimation noise/occlusion changes. See ml/README.md for
the full caveat; it must stay exactly this prominent wherever this module's
output is described, not just in this docstring.

Every function here is pure and takes its randomness as already-sampled
parameters (mirrors the style of normalize.py's mirror_frame): callers
(prepare_dataset.py) own the `np.random.Generator` and are responsible for
only ever applying this to TRAIN-split source sequences.
"""
from __future__ import annotations

import numpy as np

from .normalize import hip_center

MIN_FRAMES_PER_SEGMENT = 5
MAX_SEGMENTS = 3


def rotate_sequence_about_vertical(keypoints: np.ndarray, angle_deg: float) -> np.ndarray:
    """Rotate every frame's (x, z) coordinates about that frame's own hip
    center by one fixed angle for the whole sequence; y (vertical) is
    untouched. Simulates a camera at a different, fixed horizontal azimuth
    for the entire clip (not a moving camera).

    This is a rigid transform about the hip center, so torso_scale and
    every joint_angle (elbow angles, torso_lean_angle) computed downstream
    are mathematically unchanged -- see
    scripts/verify_synthetic_augmentation.py for the regression test this
    invariant makes possible. Only features that depend on absolute x/z
    direction (elbow_forward_drift_active, the raw-landmark channel) change.
    """
    theta = np.radians(angle_deg)
    cos_t, sin_t = np.cos(theta), np.sin(theta)
    out = keypoints.astype(float).copy()
    for t in range(out.shape[0]):
        cx, _, cz = hip_center(out[t])
        x = out[t, :, 0] - cx
        z = out[t, :, 2] - cz
        out[t, :, 0] = x * cos_t + z * sin_t + cx
        out[t, :, 2] = -x * sin_t + z * cos_t + cz
    return out


def choose_num_segments(num_frames: int, max_segments: int = MAX_SEGMENTS,
                         min_frames_per_segment: int = MIN_FRAMES_PER_SEGMENT) -> int:
    return max(1, min(max_segments, num_frames // min_frames_per_segment))


def make_equal_segments(num_frames: int, num_segments: int) -> list[tuple[int, int]]:
    """k contiguous [start, end) index ranges covering [0, num_frames); the
    last segment absorbs any remainder from integer division."""
    base = num_frames // num_segments
    bounds = []
    start = 0
    for i in range(num_segments):
        end = num_frames if i == num_segments - 1 else start + base
        bounds.append((start, end))
        start = end
    return bounds


def _resample_segment(segment: np.ndarray, new_len: int) -> np.ndarray:
    seg_len = segment.shape[0]
    if seg_len < 2 or new_len <= 1:
        # Too short to interpolate meaningfully -- repeat the last frame.
        idx = np.clip(np.arange(new_len), 0, seg_len - 1)
        return segment[idx]
    old_idx = np.arange(seg_len)
    new_idx = np.linspace(0, seg_len - 1, new_len)
    flat = segment.reshape(seg_len, -1)
    resampled = np.empty((new_len, flat.shape[1]), dtype=float)
    for col in range(flat.shape[1]):
        resampled[:, col] = np.interp(new_idx, old_idx, flat[:, col])
    return resampled.reshape(new_len, *segment.shape[1:])


def segment_time_warp(keypoints: np.ndarray, segment_bounds: list[tuple[int, int]],
                       factors: list[float]) -> np.ndarray:
    """Resample each [start, end) segment independently at its own speed
    factor (factor > 1 = faster/shorter, factor < 1 = slower/longer) via
    linear interpolation, then concatenate. No randomness inside -- callers
    sample `factors`.

    Because each segment's new length is proportional to its (roughly
    equal) share of the total, and each factor is drawn from the same
    range, the resulting total sequence length is automatically bounded to
    that same range relative to the original -- no separate re-clamping
    of the total length is needed.
    """
    pieces = []
    for (start, end), factor in zip(segment_bounds, factors):
        segment = keypoints[start:end]
        new_len = max(1, round(segment.shape[0] / factor))
        pieces.append(_resample_segment(segment, new_len))
    return np.concatenate(pieces, axis=0)


def generate_synthetic_variant(
    keypoints: np.ndarray, rng: np.random.Generator, *,
    mode: str = "both",
    rotation_deg_range: tuple[float, float] = (-15.0, 15.0),
    warp_factor_range: tuple[float, float] = (0.80, 1.25),
    max_segments: int = MAX_SEGMENTS,
    min_frames_per_segment: int = MIN_FRAMES_PER_SEGMENT,
) -> np.ndarray:
    """Apply warp (if enabled) then rotation (if enabled) to one raw
    (T,33,3) keypoints array and return a new synthetic variant.
    `mode` in {"rotation", "warp", "both"}.
    """
    if mode not in ("rotation", "warp", "both"):
        raise ValueError(f"unknown mode: {mode!r}")

    out = keypoints
    if mode in ("warp", "both"):
        num_segments = choose_num_segments(out.shape[0], max_segments, min_frames_per_segment)
        bounds = make_equal_segments(out.shape[0], num_segments)
        factors = rng.uniform(warp_factor_range[0], warp_factor_range[1], size=num_segments)
        out = segment_time_warp(out, bounds, factors.tolist())

    if mode in ("rotation", "both"):
        angle = rng.uniform(rotation_deg_range[0], rotation_deg_range[1])
        out = rotate_sequence_about_vertical(out, float(angle))

    return out
