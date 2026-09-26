#!/usr/bin/env python3
"""Build the processed bicep-curl phase-classification dataset from the raw
provided ZIP/directory.

Pipeline per subject sequence:
  raw COCO keypoints (T,17,3)
    -> SequenceNormalizer.step() per frame (hip-center, scale, mirror)   [causal]
    -> FeatureExtractor.step() per frame  -> (T, 7) feature matrix        [causal]
    -> phase_labels.label_sequence()      -> (T,) phase labels            [offline, non-causal]

Outputs (all under ml/data/processed/):
  bicep_curl_phases.csv   - one row per frame: subject_id, frame_idx, 7 features, label, rep_count
  label_config.json       - frozen thresholds used to derive phase labels
  subject_split.json      - which subject_ids are train/val/test (fixed seed, no frame leakage)
  dataset_report.json     - the stats item 1 of the spec asks to report before training

Usage:
  python -m ml.scripts.prepare_dataset --raw /path/to/VidData or /path/to/VidData.zip
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ML_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ML_ROOT.parent
sys.path.insert(0, str(REPO_ROOT))

from ml.src.preprocessing.dataset_io import load_all_sequences
from ml.src.preprocessing.normalize import SequenceNormalizer
from ml.src.features.engineer import FeatureExtractor, FEATURE_NAMES
from ml.src.labeling.phase_labels import fit_label_config, label_sequence, PHASE_NAMES

PROCESSED_DIR = ML_ROOT / "data" / "processed"
SEED = 42


def normalize_and_featurize(raw_keypoints: np.ndarray):
    """Replay one sequence causally through the shared normalizer + feature
    extractor -- the exact same object graph that inference uses. Returns
    (normalized_coords_list, feature_matrix, active_side_final).
    """
    normalizer = SequenceNormalizer()
    extractor = FeatureExtractor()
    norm_coords = []
    features = []
    active_side = None
    for frame in raw_keypoints:
        nf = normalizer.step(frame)
        norm_coords.append(nf.coords)
        features.append(extractor.step(nf.coords))
        active_side = nf.active_side_raw
    return norm_coords, np.stack(features), active_side


def subject_split(subject_ids: list[str], train_frac=0.70, val_frac=0.15, seed=SEED):
    rng = np.random.RandomState(seed)
    ids = list(subject_ids)
    rng.shuffle(ids)
    n = len(ids)
    n_train = max(1, round(n * train_frac))
    n_val = max(1, round(n * val_frac))
    n_val = min(n_val, n - n_train - 1) if n - n_train - 1 >= 1 else n_val
    train_ids = sorted(ids[:n_train])
    val_ids = sorted(ids[n_train:n_train + n_val])
    test_ids = sorted(ids[n_train + n_val:])
    return {"train": train_ids, "val": val_ids, "test": test_ids}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", required=True, help="Path to extracted VidData dir or the original .zip")
    args = ap.parse_args()

    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Loading raw sequences from {args.raw} ...")
    raw_sequences = load_all_sequences(args.raw)
    print(f"Loaded {len(raw_sequences)} sequences (subjects).")

    all_norm_coords = []
    all_features = []
    all_active_sides = []
    per_subject_rows = []

    for seq in raw_sequences:
        norm_coords, feats, active_side = normalize_and_featurize(seq.keypoints)
        all_norm_coords.append(norm_coords)
        all_features.append(feats)
        all_active_sides.append(active_side)
        per_subject_rows.append((seq.subject_id, seq.num_frames, seq.gender, active_side))
        print(f"  {seq.subject_id}: {seq.num_frames} frames, gender={seq.gender}, "
              f"detected active arm={active_side}")

    print("Fitting phase-label thresholds (pooled across all sequences)...")
    label_config = fit_label_config(all_norm_coords)
    print(f"  label_config = {label_config.to_dict()}")

    print("Labeling every frame...")
    all_labels = [label_sequence(nc, label_config) for nc in all_norm_coords]

    # Assemble the flat per-frame table.
    rows = []
    for seq, feats, labels in zip(raw_sequences, all_features, all_labels):
        for t in range(seq.num_frames):
            row = {"subject_id": seq.subject_id, "frame_idx": t,
                   "rep_count": float(seq.rep_count[t]), "label": labels[t]}
            for fname, fval in zip(FEATURE_NAMES, feats[t]):
                row[fname] = float(fval)
            rows.append(row)
    df = pd.DataFrame(rows)

    subject_ids = [s.subject_id for s in raw_sequences]
    split = subject_split(subject_ids)

    # --- Dataset report (item 1 of the spec) ---
    class_counts = df["label"].value_counts().to_dict()
    frames_per_subject = df.groupby("subject_id").size().to_dict()
    split_class_counts = {}
    for part, ids in split.items():
        sub_df = df[df["subject_id"].isin(ids)]
        split_class_counts[part] = {
            "num_subjects": len(ids),
            "num_frames": int(len(sub_df)),
            "class_counts": sub_df["label"].value_counts().to_dict(),
        }

    report = {
        "num_sequences_bicep": len(raw_sequences),
        "num_subjects": len(raw_sequences),
        "num_total_frames": int(len(df)),
        "sequence_length_frames": {
            "min": int(min(frames_per_subject.values())),
            "max": int(max(frames_per_subject.values())),
            "mean": float(np.mean(list(frames_per_subject.values()))),
        },
        "num_classes": len(PHASE_NAMES),
        "class_names": PHASE_NAMES,
        "class_counts_overall": class_counts,
        "class_balance_ratio_max_min": (
            max(class_counts.values()) / min(class_counts.values()) if class_counts else None
        ),
        "active_arm_detected_per_subject": dict(zip(subject_ids, all_active_sides)),
        "gender_distribution": pd.Series([s.gender for s in raw_sequences]).value_counts().to_dict(),
        "landmarks_used": FEATURE_NAMES,
        "data_format": "COCO-style JSON (info/categories/images/annotations) + companion mp4 (unused)",
        "missing_or_corrupted_sequences": 0,
        "split": split_class_counts,
    }

    # --- Save everything ---
    csv_path = PROCESSED_DIR / "bicep_curl_phases.csv"
    df.to_csv(csv_path, index=False)

    with open(PROCESSED_DIR / "label_config.json", "w") as f:
        json.dump(label_config.to_dict(), f, indent=2)
    with open(PROCESSED_DIR / "subject_split.json", "w") as f:
        json.dump(split, f, indent=2)
    with open(PROCESSED_DIR / "dataset_report.json", "w") as f:
        json.dump(report, f, indent=2, default=str)
    with open(PROCESSED_DIR / "feature_config.json", "w") as f:
        json.dump({"feature_names": FEATURE_NAMES}, f, indent=2)

    print(f"\nSaved processed dataset: {csv_path} ({len(df)} rows)")
    print(f"Saved: label_config.json, subject_split.json, feature_config.json, dataset_report.json")
    print("\n--- DATASET REPORT SUMMARY ---")
    print(json.dumps(report, indent=2, default=str))


if __name__ == "__main__":
    main()
