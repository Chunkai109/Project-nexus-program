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

Outputs under ml/data/processed/:
  sequences.npz            - per-frame engineered + raw arrays, one per video_id
                              (object arrays: variable length per sequence)
  sequence_features.csv    - one row per video_id: aggregated features + label + base_id
  base_id_split.json       - which base_ids are train/val/test
  label_config.json        - class list (fixed order)
  feature_config.json      - engineered + raw feature names
  dataset_report.json      - stats required by the project spec
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split

ML_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ML_ROOT.parent
sys.path.insert(0, str(REPO_ROOT))

from ml.src.preprocessing.dataset_io import load_all_sequences
from ml.src.preprocessing.normalize import SequenceNormalizer
from ml.src.features.engineer import (
    FeatureExtractor, FEATURE_NAMES, RAW_JOINTS, RAW_DIM,
    raw_landmark_vector, aggregate_sequence_features, AGGREGATE_FEATURE_NAMES,
)

PROCESSED_DIR = ML_ROOT / "data" / "processed"
SEED = 42
CLASS_NAMES = ["Perfect", "Drag", "Swing", "Half", "Heave"]


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


def main():
    ap_csv = sys.argv[sys.argv.index("--csv") + 1] if "--csv" in sys.argv else None
    if ap_csv is None:
        raise SystemExit("usage: prepare_dataset.py --csv /path/to/reduced.csv")

    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Loading sequences from {ap_csv} ...")
    sequences = load_all_sequences(ap_csv)
    print(f"Loaded {len(sequences)} video_id sequences "
          f"({len(set(s.base_id for s in sequences))} independent source recordings).")

    engineered_by_vid, raw_by_vid = {}, {}
    agg_rows = []
    base_id_labels = {}

    for seq in sequences:
        eng, raw, active_side = normalize_and_featurize(seq.keypoints)
        engineered_by_vid[seq.video_id] = eng
        raw_by_vid[seq.video_id] = raw
        base_id_labels[seq.base_id] = seq.class_label

        agg = aggregate_sequence_features(eng)
        row = {"video_id": seq.video_id, "base_id": seq.base_id,
               "is_original": seq.is_original, "class_label": seq.class_label,
               "num_frames": seq.num_frames, "active_side_detected": active_side}
        row.update(dict(zip(AGGREGATE_FEATURE_NAMES, agg)))
        agg_rows.append(row)

    print("Splitting by independent source recording (base_id), stratified by class...")
    split = split_base_ids(base_id_labels)
    for part, ids in split.items():
        counts = pd.Series([base_id_labels[i] for i in ids]).value_counts().to_dict()
        print(f"  {part}: {len(ids)} source recordings -> {counts}")

    # --- Save per-frame sequence arrays (object arrays; variable length) ---
    video_ids = [s.video_id for s in sequences]
    np.savez_compressed(
        PROCESSED_DIR / "sequences.npz",
        video_ids=np.array(video_ids, dtype=object),
        base_ids=np.array([s.base_id for s in sequences], dtype=object),
        labels=np.array([s.class_label for s in sequences], dtype=object),
        is_original=np.array([s.is_original for s in sequences], dtype=bool),
        engineered=np.array([engineered_by_vid[v] for v in video_ids], dtype=object),
        raw=np.array([raw_by_vid[v] for v in video_ids], dtype=object),
        allow_pickle=True,
    )

    # --- Save per-sequence aggregated features (classical ML input) ---
    agg_df = pd.DataFrame(agg_rows)
    agg_df.to_csv(PROCESSED_DIR / "sequence_features.csv", index=False)

    with open(PROCESSED_DIR / "base_id_split.json", "w") as f:
        json.dump(split, f, indent=2)
    with open(PROCESSED_DIR / "label_config.json", "w") as f:
        json.dump({"class_names": CLASS_NAMES}, f, indent=2)
    with open(PROCESSED_DIR / "feature_config.json", "w") as f:
        json.dump({
            "engineered_feature_names": FEATURE_NAMES,
            "raw_joint_names": RAW_JOINTS,
            "raw_dim": RAW_DIM,
            "aggregate_feature_names": AGGREGATE_FEATURE_NAMES,
        }, f, indent=2)

    # --- Dataset report (spec item 1) ---
    frames_per_video = {s.video_id: s.num_frames for s in sequences}
    orig_sequences = [s for s in sequences if s.is_original]
    report = {
        "num_video_ids_total": len(sequences),
        "num_independent_source_recordings": len(base_id_labels),
        "note_on_augmentation": (
            "Each of the 49 independent source recordings appears 11 times in "
            "the CSV (1 '_orig' + 10 pre-generated '_aug_*' copies, 539 rows "
            "total video_ids). All splitting is done on the 49 base_ids so "
            "augmented copies of a training recording never appear in val/test."
        ),
        "num_total_frames": int(sum(frames_per_video.values())),
        "sequence_length_frames": {
            "min": int(min(frames_per_video.values())),
            "max": int(max(frames_per_video.values())),
            "mean": float(np.mean(list(frames_per_video.values()))),
        },
        "num_classes": len(CLASS_NAMES),
        "class_names": CLASS_NAMES,
        "class_counts_source_recordings": pd.Series(list(base_id_labels.values())).value_counts().to_dict(),
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
            "class_counts": pd.Series([base_id_labels[i] for i in ids]).value_counts().to_dict(),
        } for part, ids in split.items()},
    }
    with open(PROCESSED_DIR / "dataset_report.json", "w") as f:
        json.dump(report, f, indent=2, default=str)

    print(f"\nSaved sequences.npz, sequence_features.csv, base_id_split.json, "
          f"label_config.json, feature_config.json, dataset_report.json to {PROCESSED_DIR}")
    print("\n--- DATASET REPORT SUMMARY ---")
    print(json.dumps(report, indent=2, default=str))


if __name__ == "__main__":
    main()
