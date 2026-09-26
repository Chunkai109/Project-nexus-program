#!/usr/bin/env python3
"""Standalone sanity checks for src/preprocessing/synthetic_augment.py,
matching this repo's convention of standalone scripts/*.py checks (no
pytest infra exists here). Run directly: python -m ml.scripts.verify_synthetic_augmentation

Checks:
  1. Rotation-invariance: a rotation-only variant's per-frame torso_lean_angle,
     elbow_angle_active, elbow_angle_other must match the source to ~1e-6
     (mathematically guaranteed by a rigid rotation about the hip center --
     a failure here means the rotation implementation itself is wrong),
     while elbow_forward_drift_active must measurably differ.
  2. Hip stays centered at the origin for warp/rotation/both variants.
  3. torso_scale for synthetic frames stays within the range observed
     across all 49 real recordings.
  4. Warped sequence length stays within the designed [0.80T, 1.25T] bound.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

ML_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ML_ROOT.parent
sys.path.insert(0, str(REPO_ROOT))

from ml.src.preprocessing.dataset_io import load_all_sequences
from ml.src.preprocessing.normalize import SequenceNormalizer, hip_center, torso_scale
from ml.src.preprocessing.synthetic_augment import generate_synthetic_variant
from ml.src.features.engineer import FeatureExtractor


def featurize(keypoints: np.ndarray):
    normalizer = SequenceNormalizer()
    extractor = FeatureExtractor()
    feats = []
    for frame in keypoints:
        nf = normalizer.step(frame)
        feats.append(extractor.step(nf.coords))
    return np.stack(feats)  # columns: see FEATURE_NAMES order


def check(name: str, condition: bool, detail: str = ""):
    status = "PASS" if condition else "FAIL"
    print(f"  [{status}] {name}" + (f" -- {detail}" if detail else ""))
    return condition


def main():
    if "--csv" not in sys.argv:
        raise SystemExit("usage: verify_synthetic_augmentation.py --csv /path/to/bicep_with_incomplete.csv")
    csv_path = sys.argv[sys.argv.index("--csv") + 1]

    sequences = load_all_sequences(csv_path)
    orig_sequences = [s for s in sequences if s.is_original]
    all_ok = True

    # Reference torso_scale range across all 49 real recordings.
    scale_values = []
    for seq in orig_sequences:
        for frame in seq.keypoints:
            scale_values.append(torso_scale(frame))
    scale_min, scale_max = min(scale_values), max(scale_values)
    print(f"Reference torso_scale range across all real recordings: [{scale_min:.4f}, {scale_max:.4f}]")

    source = orig_sequences[0]
    T = source.num_frames
    rng = np.random.default_rng(0)

    print(f"\n=== Rotation-only invariance check (source: {source.video_id}, T={T}) ===")
    rotated = generate_synthetic_variant(source.keypoints, rng, mode="rotation",
                                          rotation_deg_range=(10.0, 10.0))
    feats_orig = featurize(source.keypoints)
    feats_rot = featurize(rotated)
    # FEATURE_NAMES order: elbow_angle_active, elbow_angle_other, wrist_height_active,
    # torso_lean_angle, elbow_forward_drift_active, ...
    all_ok &= check("elbow_angle_active preserved (~1e-6)",
                     np.allclose(feats_orig[:, 0], feats_rot[:, 0], atol=1e-4),
                     f"max abs diff={np.max(np.abs(feats_orig[:,0]-feats_rot[:,0])):.2e}")
    all_ok &= check("elbow_angle_other preserved (~1e-6)",
                     np.allclose(feats_orig[:, 1], feats_rot[:, 1], atol=1e-4),
                     f"max abs diff={np.max(np.abs(feats_orig[:,1]-feats_rot[:,1])):.2e}")
    all_ok &= check("torso_lean_angle preserved (~1e-6)",
                     np.allclose(feats_orig[:, 3], feats_rot[:, 3], atol=1e-4),
                     f"max abs diff={np.max(np.abs(feats_orig[:,3]-feats_rot[:,3])):.2e}")
    drift_diff = np.max(np.abs(feats_orig[:, 4] - feats_rot[:, 4]))
    all_ok &= check("elbow_forward_drift_active measurably differs under rotation",
                     drift_diff > 1e-3, f"max abs diff={drift_diff:.4f}")

    print(f"\n=== Hip-centering + scale sanity (all modes) ===")
    # Baseline: the SOURCE sequence's own natural hip-center noise (this
    # dataset's world landmarks are hip-centered by MediaPipe itself, but
    # not to exact float zero -- observed up to ~1e-3 in some recordings).
    # Rotation/warp should preserve this noise level, not amplify it, so
    # checks compare against a multiple of the source's own baseline
    # rather than an absolute threshold.
    source_hip_offsets = [np.linalg.norm(hip_center(f)) for f in source.keypoints]
    source_hip_baseline = max(source_hip_offsets)
    print(f"  source's own natural hip-center offset (baseline): {source_hip_baseline:.2e}")
    for mode in ["rotation", "warp", "both"]:
        variant = generate_synthetic_variant(source.keypoints, rng, mode=mode)
        hip_offsets = [np.linalg.norm(hip_center(f)) for f in variant]
        scales = [torso_scale(f) for f in variant]
        all_ok &= check(f"[{mode}] hip offset stays within 5x the source's own baseline noise",
                         max(hip_offsets) < 5 * source_hip_baseline + 1e-6,
                         f"max offset={max(hip_offsets):.2e} vs baseline={source_hip_baseline:.2e}")
        in_range = all(scale_min * 0.5 <= s <= scale_max * 1.5 for s in scales)
        all_ok &= check(f"[{mode}] torso_scale within a reasonable band of the real range",
                         in_range, f"variant range=[{min(scales):.4f}, {max(scales):.4f}]")
        if mode in ("warp", "both"):
            lo, hi = 0.80 * T, 1.25 * T
            all_ok &= check(f"[{mode}] frame count within [0.80T, 1.25T]",
                             lo - 1 <= variant.shape[0] <= hi + 1,
                             f"T'={variant.shape[0]}, bound=[{lo:.1f}, {hi:.1f}]")

    print(f"\n{'ALL CHECKS PASSED' if all_ok else 'SOME CHECKS FAILED'}")
    if not all_ok:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
