#!/usr/bin/env python3
"""Build the processed PhysioVision bicep-curl dataset.

Pipeline per video sequence:
  raw MediaPipe world-landmark rows (T,33,3)
    -> SequenceNormalizer.step() per frame (scale, mirror)      [causal]
    -> FeatureExtractor.step()   per frame -> (T,8) engineered   [causal]
    -> raw_landmark_vector()     per frame -> (T,27) raw channel [causal]
    -> aggregate_sequence_features() -> (41,) per-sequence summary for classical ML

Splitting: by `base_id` (the 49 independent source recordings), NOT by
video_id, so that a source video's pre-generated augmented copies never
span train/val/test (see dataset_io.py for why). Stratified by class at
the base_id level so every split sees all 5 classes.

Optional extra synthetic augmentation (--n-synthetic-extra, default 0 =
today's exact behavior): generates additional rotation/time-warp variants
of TRAIN-split `_orig` recordings only (see
src/preprocessing/synthetic_augment.py and ml/README.md's "Synthetic
augmentation of the training split" section). The base_id split below is
always computed from the real (CSV-provided) sequences FIRST, then
synthetic extras are generated only for base_ids already assigned to
train -- this ordering is what guarantees they can never influence, or
leak into, val/test.

Outputs under ml/data/processed[_<tag>]/:
  sequences.npz            - per-frame engineered + raw arrays, one per video_id
                              (object arrays: variable length per sequence)
  sequence_features.csv    - one row per video_id: aggregated features + label + base_id
  base_id_split.json       - which base_ids are train/val/test
  label_config.json        - class list (fixed order)
  feature_config.json      - engineered + raw feature names
  dataset_report.json      - stats required by the project spec
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split

ML_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ML_ROOT.parent
sys.path.insert(0, str(REPO_ROOT))

from ml.src.preprocessing.dataset_io import load_all_sequences, make_synthetic_sequence
from ml.src.preprocessing.normalize import SequenceNormalizer
from ml.src.preprocessing.synthetic_augment import generate_synthetic_variant
from ml.src.features.engineer import (
    FeatureExtractor, FEATURE_NAMES, RAW_JOINTS, RAW_DIM,
    raw_landmark_vector, aggregate_sequence_features, AGGREGATE_FEATURE_NAMES,
)
from ml.src.models.labels import CLASS_NAMES

SEED = 42


def normalize_and_featurize(raw_keypoints: np.ndarray):
    normalizer = SequenceNormalizer()
    extractor = FeatureExtractor()
    engineered, raw = [], []
    active_side = None
    for frame in raw_keypoints:
        nf = normalizer.step(frame)
        engineered.append(extractor.step(nf.coords))
        raw.append(raw_landmark_vector(nf.coords))
        active_side = nf.active_side_raw
    return np.stack(engineered), np.stack(raw), active_side


def split_base_ids(base_id_labels: dict[str, str], seed=SEED):
    ids = sorted(base_id_labels.keys())
    labels = [base_id_labels[i] for i in ids]
    train_ids, rest_ids, train_lbl, rest_lbl = train_test_split(
        ids, labels, test_size=0.30, random_state=seed, stratify=labels)
    val_ids, test_ids, _, _ = train_test_split(
        rest_ids, rest_lbl, test_size=0.50, random_state=seed, stratify=rest_lbl)
    return {"train": sorted(train_ids), "val": sorted(val_ids), "test": sorted(test_ids)}


def parse_args():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True)
    ap.add_argument("--tag", default="", help="if set, writes to data/processed_<tag>/ instead "
                                                 "of overwriting the committed data/processed/")
    ap.add_argument("--n-synthetic-extra", type=int, default=0,
                     help="extra rotation/warp synthetic copies per TRAIN-split '_orig' "
                          "recording (default 0 = today's exact behavior, no extra augmentation)")
    ap.add_argument("--synthetic-mode", choices=["rotation", "warp", "both"], default="both")
    ap.add_argument("--rotation-deg-max", type=float, default=15.0)
    ap.add_argument("--warp-min", type=float, default=0.80)
    ap.add_argument("--warp-max", type=float, default=1.25)
    ap.add_argument("--max-segments", type=int, default=3)
    return ap.parse_args()


def main():
    args = parse_args()
    processed_dir = ML_ROOT / "data" / (f"processed_{args.tag}" if args.tag else "processed")
    processed_dir.mkdir(parents=True, exist_ok=True)

    print(f"Loading sequences from {args.csv} ...")
    sequences = load_all_sequences(args.csv)
    print(f"Loaded {len(sequences)} video_id sequences "
          f"({len(set(s.base_id for s in sequences))} independent source recordings).")

    # A base_id's PRIMARY label -- used only to stratify the split. Most
    # base_ids have exactly one class. But 17 of the 49 are also truncated
    # into a derived "Incomplete" sequence (see dataset_io.py's module
    # docstring) -- for those, `class_label` would otherwise flip depending
    # on iteration order. We stratify by the non-truncated ("primary")
    # label so the split balances the 5 real performance classes; because
    # splitting is by base_id, wherever a recording lands, its Incomplete
    # truncations go with it automatically, so this never risks separating
    # a recording from its own truncation. This is a cheap metadata-only
    # pass (no featurization), done BEFORE any synthetic generation so the
    # split can never be influenced by synthetic copies.
    base_id_primary_label = {}
    for seq in sequences:
        if not seq.is_truncated:
            base_id_primary_label[seq.base_id] = seq.class_label

    print("Splitting by independent source recording (base_id), stratified by primary class...")
    split = split_base_ids(base_id_primary_label)
    for part, ids in split.items():
        counts = pd.Series([base_id_primary_label[i] for i in ids]).value_counts().to_dict()
        print(f"  {part}: {len(ids)} source recordings (primary label) -> {counts}")

    # --- Extra synthetic augmentation: TRAIN-split '_orig' sequences only ---
    synthetic_sequences = []
    if args.n_synthetic_extra > 0:
        train_id_set = set(split["train"])
        rng = np.random.default_rng(SEED)
        for seq in sequences:
            if seq.base_id in train_id_set and seq.is_original:
                for k in range(args.n_synthetic_extra):
                    variant_kps = generate_synthetic_variant(
                        seq.keypoints, rng, mode=args.synthetic_mode,
                        rotation_deg_range=(-args.rotation_deg_max, args.rotation_deg_max),
                        warp_factor_range=(args.warp_min, args.warp_max),
                        max_segments=args.max_segments,
                    )
                    synthetic_sequences.append(make_synthetic_sequence(seq, variant_kps, f"synth{k}"))
        # Load-bearing safety check: every synthetic sequence's base_id must
        # be in the train split -- this is what actually proves the
        # split-before-augment ordering above was respected, not just
        # correct in code review.
        synthetic_base_ids = set(s.base_id for s in synthetic_sequences)
        assert synthetic_base_ids <= train_id_set, (
            f"synthetic sequences leaked outside the train split: "
            f"{synthetic_base_ids - train_id_set}"
        )
        print(f"Generated {len(synthetic_sequences)} extra synthetic sequences "
              f"(mode={args.synthetic_mode}, {args.n_synthetic_extra} per train '_orig' recording), "
              f"sourced only from the {len(train_id_set)} train-split base_ids.")

    all_sequences = sorted(sequences + synthetic_sequences, key=lambda s: s.video_id)

    # --- Normalize + featurize everything (real + synthetic), unchanged pipeline ---
    engineered_by_vid, raw_by_vid = {}, {}
    agg_rows = []
    for seq in all_sequences:
        eng, raw, active_side = normalize_and_featurize(seq.keypoints)
        engineered_by_vid[seq.video_id] = eng
        raw_by_vid[seq.video_id] = raw

        agg = aggregate_sequence_features(eng)
        row = {"video_id": seq.video_id, "base_id": seq.base_id,
               "is_original": seq.is_original, "is_truncated": seq.is_truncated,
               "is_synthetic_extra": seq.is_synthetic_extra,
               "class_label": seq.class_label,
               "num_frames": seq.num_frames, "active_side_detected": active_side}
        row.update(dict(zip(AGGREGATE_FEATURE_NAMES, agg)))
        agg_rows.append(row)

    # --- Save per-frame sequence arrays (object arrays; variable length) ---
    video_ids = [s.video_id for s in all_sequences]
    np.savez_compressed(
        processed_dir / "sequences.npz",
        video_ids=np.array(video_ids, dtype=object),
        base_ids=np.array([s.base_id for s in all_sequences], dtype=object),
        labels=np.array([s.class_label for s in all_sequences], dtype=object),
        is_original=np.array([s.is_original for s in all_sequences], dtype=bool),
        is_truncated=np.array([s.is_truncated for s in all_sequences], dtype=bool),
        is_synthetic_extra=np.array([s.is_synthetic_extra for s in all_sequences], dtype=bool),
        engineered=np.array([engineered_by_vid[v] for v in video_ids], dtype=object),
        raw=np.array([raw_by_vid[v] for v in video_ids], dtype=object),
        allow_pickle=True,
    )

    # --- Save per-sequence aggregated features (classical ML input) ---
    agg_df = pd.DataFrame(agg_rows)
    agg_df.to_csv(processed_dir / "sequence_features.csv", index=False)

    with open(processed_dir / "base_id_split.json", "w") as f:
        json.dump(split, f, indent=2)
    with open(processed_dir / "label_config.json", "w") as f:
        json.dump({"class_names": CLASS_NAMES}, f, indent=2)
    with open(processed_dir / "feature_config.json", "w") as f:
        json.dump({
            "engineered_feature_names": FEATURE_NAMES,
            "raw_joint_names": RAW_JOINTS,
            "raw_dim": RAW_DIM,
            "aggregate_feature_names": AGGREGATE_FEATURE_NAMES,
        }, f, indent=2)

    # --- Dataset report (spec item 1) ---
    frames_per_video = {s.video_id: s.num_frames for s in all_sequences}
    orig_sequences = [s for s in sequences if s.is_original]
    truncated_base_ids = sorted(set(s.base_id for s in sequences if s.is_truncated))
    report = {
        "num_video_ids_total": len(sequences),
        "num_video_ids_total_incl_synthetic_extra": len(all_sequences),
        "num_independent_source_recordings": len(base_id_primary_label),
        "note_on_augmentation": (
            "Each of the 49 independent source recordings appears 11 times in "
            "the CSV (1 '_orig' + 10 pre-generated '_aug_*' copies). All splitting "
            "is done on the 49 base_ids so augmented copies of a training recording "
            "never appear in val/test."
        ),
        "note_on_incomplete_class": (
            f"{len(truncated_base_ids)} of the 49 recordings (all with primary label "
            "'Perfect') are ALSO truncated to a randomized fraction of their length "
            "(observed ~19%-83%) and relabeled 'Incomplete', as 'incomplete_vid_00NN_*' "
            "rows. These are byte-identical prefixes of the untruncated recording, not "
            "independent performances -- stratification uses each base_id's primary "
            "(non-Incomplete) label, and because splitting is by base_id, a recording's "
            "Incomplete truncations always land in the same split as the recording "
            "itself, never separated across train/val/test."
        ),
        "note_on_synthetic_extra_augmentation": {
            "num_synthetic_extra_sequences": len(synthetic_sequences),
            "source_policy": (
                "generated only from '_orig' sequences whose base_id is in the TRAIN "
                "split; val/test base_ids and pre-generated '_aug_*' copies are never "
                "used as sources"
            ),
            "params": {
                "n_copies_per_source": args.n_synthetic_extra,
                "mode": args.synthetic_mode,
                "rotation_deg_range": [-args.rotation_deg_max, args.rotation_deg_max],
                "warp_factor_range": [args.warp_min, args.warp_max],
                "max_segments": args.max_segments,
            },
            "caveat": (
                "This increases synthetic diversity of the same 34 real training "
                "performances -- it does not add independent new information about "
                "bicep-curl form. A rigid rotation of already-reconstructed 3D "
                "landmarks is not the same as re-filming from a different angle and "
                "re-running MediaPipe's own angle-dependent pose estimator on it -- "
                "it cannot capture real angle-dependent estimation noise or occlusion "
                "changes. No real validation data exists to confirm this actually "
                "helps under real camera/lighting conditions; only the synthetic CV "
                "metric can be checked. See ml/README.md for the full discussion."
            ),
        },
        "truncated_base_ids": truncated_base_ids,
        "num_total_frames": int(sum(frames_per_video.values())),
        "sequence_length_frames": {
            "min": int(min(frames_per_video.values())),
            "max": int(max(frames_per_video.values())),
            "mean": float(np.mean(list(frames_per_video.values()))),
        },
        "num_classes": len(CLASS_NAMES),
        "class_names": CLASS_NAMES,
        "class_counts_source_recordings_by_primary_label": pd.Series(list(base_id_primary_label.values())).value_counts().to_dict(),
        "class_counts_all_video_ids_incl_augmented": pd.Series([s.class_label for s in sequences]).value_counts().to_dict(),
        "class_counts_orig_only": pd.Series([s.class_label for s in orig_sequences]).value_counts().to_dict(),
        "landmarks_used_engineered": FEATURE_NAMES,
        "landmarks_used_raw_channel": RAW_JOINTS,
        "data_format": "CSV: video_id, class_label, frame_number, x0..x32/y0..y32/z0..z32 "
                        "(MediaPipe Pose world landmarks, hip-centered, metric)",
        "missing_values": 0,
        "subject_identifiers": (
            "Not provided. No person/subject id exists in this dataset -- video_id / "
            "base_id identifies a *recording*, not a verified unique human subject. "
            "Splitting by base_id prevents augmentation-copy leakage (the only "
            "leakage we can concretely detect and prevent from the data given), but "
            "cannot guarantee two different base_ids never show the same physical "
            "person. This is disclosed as a limitation, not claimed as true "
            "subject-independence."
        ),
        "split": {part: {
            "num_source_recordings": len(ids),
            "primary_label_counts": pd.Series([base_id_primary_label[i] for i in ids]).value_counts().to_dict(),
            "all_sequence_class_counts": pd.Series(
                [s.class_label for s in all_sequences if s.base_id in set(ids)]
            ).value_counts().to_dict(),
        } for part, ids in split.items()},
    }
    with open(processed_dir / "dataset_report.json", "w") as f:
        json.dump(report, f, indent=2, default=str)

    print(f"\nSaved sequences.npz, sequence_features.csv, base_id_split.json, "
          f"label_config.json, feature_config.json, dataset_report.json to {processed_dir}")
    print("\n--- DATASET REPORT SUMMARY ---")
    print(json.dumps(report, indent=2, default=str))


if __name__ == "__main__":
    main()
