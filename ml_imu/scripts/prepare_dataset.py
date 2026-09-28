#!/usr/bin/env python3
"""Parse the raw IMU/EMG wearable-device logs and attach quality labels.

Usage: python -m ml_imu.scripts.prepare_dataset

Labels for tests 1-30 come from the user's own session notes (what was
actually done in each test) -- NOT derived from the sensor data. The
per-group sensor-pattern stats printed below are a corroborating sanity
check on those independently-provided labels, not their source (see
ml_imu/README.md for the full reasoning -- this distinction matters for
avoiding circular labeling).

Tests 31-35 ("multiple reps without fully putting hands down") get no
single whole-file label: the device's own State field cannot locate
individual reps in these files (confirmed: it transitions DOWN->CURLING->
TOP once, then stays TOP for the rest of the session), so they are
segmented into individual reps via prominence-thresholded peak detection
on the raw Flex curve (ml_imu/src/segment.py) and each detected rep is
labeled "Half" -- full ROM at the top, compromised (non-reset) ROM at the
bottom, the mirror image of insufficient top-end curl.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ML_IMU_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ML_IMU_ROOT.parent
sys.path.insert(0, str(REPO_ROOT))

from ml_imu.src.parse_log import load_all_sessions
from ml_imu.src.segment import find_reps, DEFAULT_PROMINENCE, DEFAULT_MIN_DISTANCE

RAW_DIR = ML_IMU_ROOT / "data" / "imu_raw"
PROCESSED_DIR = ML_IMU_ROOT / "data" / "processed"

# Whole-file labels for tests 1-30, from the user's own session notes
# (independent ground truth -- see module docstring). Each note states the
# corroborating sensor-pattern evidence checked against this label, keyed
# by test_id.
WHOLE_FILE_LABELS: dict[int, tuple[str, str]] = {}
for t in range(1, 6):
    WHOLE_FILE_LABELS[t] = ("Perfect", "normal-speed baseline; full ROM, reaches TOP")
for t in range(6, 11):
    WHOLE_FILE_LABELS[t] = ("Heave", "fast/deliberate momentum; flex_range ~101-115 vs "
                                      "~124-157 elsewhere, consistent with truncated, "
                                      "less-controlled ROM from heaving")
for t in range(11, 16):
    WHOLE_FILE_LABELS[t] = ("Perfect", "slow tempo, still correct form; full ROM, reaches TOP")
for t in range(16, 24):
    WHOLE_FILE_LABELS[t] = ("Half", "half reps; flex_range 53-72 vs 124-157 elsewhere, "
                                     "never reaches TOP")
for t in range(24, 31):
    WHOLE_FILE_LABELS[t] = ("Drag", "elbow flare; Drift spikes to +21..+33 vs roughly "
                                     "[-14,+8] in every other group")

SEGMENTED_TEST_IDS = set(range(31, 36))


def main():
    sessions = load_all_sessions(RAW_DIR)
    print(f"Parsed {len(sessions)} raw sessions from {RAW_DIR}")

    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

    # 1. Long-format per-frame CSV, all 35 sessions.
    frame_rows = []
    for s in sessions:
        for i in range(s.num_frames):
            frame_rows.append({
                "test_id": s.test_id, "frame_idx": i, "flex": s.flex[i],
                "drift": s.drift[i], "emg": int(s.emg[i]),
                "vib_on": bool(s.vib_on[i]), "state": s.state[i],
            })
    frames_df = pd.DataFrame(frame_rows)
    frames_df.to_csv(PROCESSED_DIR / "imu_sessions.csv", index=False)
    print(f"Wrote {len(frames_df)} per-frame rows to "
          f"{PROCESSED_DIR / 'imu_sessions.csv'}")

    # 2. Labels: whole-file (1-30) + segmented (31-35).
    label_rows = []
    print(f"\n=== Whole-file labels (tests 1-30) ===")
    for s in sessions:
        if s.test_id not in WHOLE_FILE_LABELS:
            continue
        label, note = WHOLE_FILE_LABELS[s.test_id]
        flex_range = float(s.flex.max() - s.flex.min())
        drift_range = float(s.drift.max() - s.drift.min())
        reached_top = bool(np.any(s.state == "TOP"))
        print(f"  Test{s.test_id:>3}: label={label:8s} flex_range={flex_range:6.1f} "
              f"drift=[{s.drift.min():.1f},{s.drift.max():.1f}] reached_top={reached_top}")
        label_rows.append({
            "test_id": s.test_id, "rep_index": 0, "start_frame": 0,
            "end_frame": s.num_frames - 1, "label": label,
            "label_source": "manual_full_session", "notes": note,
        })

    print(f"\n=== Segmented labels (tests 31-35, prominence={DEFAULT_PROMINENCE}, "
          f"distance={DEFAULT_MIN_DISTANCE}) ===")
    for s in sessions:
        if s.test_id not in SEGMENTED_TEST_IDS:
            continue
        bounds = find_reps(s.flex)
        print(f"  Test{s.test_id:>3}: n_frames={s.num_frames} -> {len(bounds)} reps detected")
        for rep_idx, (start, end) in enumerate(bounds):
            seg_flex = s.flex[start:end + 1]
            seg_range = seg_flex.max() - seg_flex.min()
            # rep_index 0 starts from the device's true calibrated "arm
            # hanging down" baseline (before any curling happened), so it
            # gets full ROM -- confirmed empirically: rep 0's flex_range is
            # always ~122-128 (matching the full-ROM Perfect/Heave/Drag
            # groups) while every later rep is always ~64-83 (matching the
            # Half group's 53-72), a clean, non-overlapping split across
            # all 5 files. Only reps 1+ show the compromised, non-reset
            # starting position the session notes describe.
            label = "Perfect" if rep_idx == 0 else "Half"
            note = (f"peak-detected segment [{start},{end}] of {s.num_frames}; "
                    f"local flex_range={seg_range:.1f}; "
                    + ("first rep of the session -- starts from the true "
                       "hanging-down baseline, full ROM" if rep_idx == 0 else
                       "later rep -- starts from the prior rep's un-reset "
                       "position, reduced ROM"))
            print(f"    rep {rep_idx}: frames [{start},{end}]  "
                  f"flex_range={seg_range:.1f}  label={label}")
            label_rows.append({
                "test_id": s.test_id, "rep_index": rep_idx, "start_frame": start,
                "end_frame": end, "label": label,
                "label_source": "peak_detection_segmented", "notes": note,
            })

    labels_df = pd.DataFrame(label_rows)
    labels_df.to_csv(ML_IMU_ROOT / "data" / "imu_labels.csv", index=False)
    print(f"\nWrote {len(labels_df)} label rows to {ML_IMU_ROOT / 'data' / 'imu_labels.csv'}")

    # 3. Dataset report.
    whole_session_rows = labels_df[labels_df.label_source == "manual_full_session"]
    segmented_rows = labels_df[labels_df.label_source == "peak_detection_segmented"]
    report = {
        "num_raw_sessions": len(sessions),
        "num_labeled_rows": len(labels_df),
        "class_counts_by_source": {
            "manual_full_session": whole_session_rows["label"].value_counts().to_dict(),
            "peak_detection_segmented": segmented_rows["label"].value_counts().to_dict(),
        },
        "note_on_label_provenance": (
            "Labels for tests 1-30 come from the user's own session notes "
            "(independent ground truth describing what was actually performed "
            "in each test), not from thresholds on the sensor data itself. "
            "The per-group sensor-pattern stats (flex_range, drift range, "
            "reached_top) printed by this script and stored in imu_labels.csv "
            "are a corroborating consistency check on those independently-"
            "provided labels, not their source -- this avoids the circular "
            "labeling problem (defining a label from a threshold on the same "
            "feature a classifier would later be trained on)."
        ),
        "note_on_segmented_sessions": (
            f"Tests 31-35 ('multiple reps without fully putting hands down') "
            f"have no single whole-file label: the device's own State field "
            f"transitions DOWN->CURLING->TOP only once per file then stays "
            f"TOP for the rest of the session while Flex keeps fluctuating, "
            f"so it cannot locate individual rep boundaries and its Reps "
            f"counter stays at 0 throughout. Segmented instead via "
            f"prominence-thresholded peak detection on the raw Flex curve "
            f"(scipy.signal.find_peaks, prominence={DEFAULT_PROMINENCE}, "
            f"distance={DEFAULT_MIN_DISTANCE}) -- NOT naive velocity "
            f"zero-crossing, which produced noisy spurious crossings during "
            f"static/settling periods. Within each file, rep_index 0 is "
            f"labeled 'Perfect' and every later rep 'Half': rep 0 starts "
            f"from the device's true calibrated hanging-down baseline "
            f"(before any curling happened) and its flex_range is always "
            f"~122-128 across all 5 files, matching the full-ROM Perfect/"
            f"Heave/Drag groups, while every later rep's flex_range is "
            f"always ~64-83, matching the Half group's 53-72 -- a clean, "
            f"non-overlapping split confirmed empirically (not assumed) "
            f"before this rule was applied. Later reps start from the prior "
            f"rep's un-reset position -- the compromised ROM the session "
            f"notes describe. label_source='peak_detection_segmented' marks "
            f"these rows so they stay distinguishable from directly-recorded "
            f"single-rep sessions."
        ),
    }
    with open(ML_IMU_ROOT / "data" / "dataset_report.json", "w") as f:
        json.dump(report, f, indent=2)
    print(f"\nWrote dataset_report.json")
    print(json.dumps(report["class_counts_by_source"], indent=2))


if __name__ == "__main__":
    main()
