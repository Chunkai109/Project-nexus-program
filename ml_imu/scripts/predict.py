#!/usr/bin/env python3
"""Replay recorded IMU sessions through the trained classifier -- no
physical IMU hardware needed, since every "test" here is a recorded rep.

Usage:
  python -m ml_imu.scripts.predict                # all 52 labeled reps
  python -m ml_imu.scripts.predict --test_id 31    # just one raw session's reps

IMPORTANT CAVEAT: unlike ml/scripts/predict.py (which replays a genuinely
held-out TEST split the model never saw), there is no held-out split for
this classifier at all -- see ml_imu/README.md for why (only 35 raw
sessions, as few as 5 groups for the rarest class). Every rep replayed here
was part of the data the final saved model was fit on. This script
demonstrates the pipeline runs end-to-end and lets you sanity-check
predictions on real recordings; it is NOT an independent accuracy number.
The GroupKFold macro-F1 in training_config.json (and the ceiling-effect
warning printed alongside it) is the number to trust -- and even that
number is flagged there as a red flag, not a validated accuracy claim, for
this dataset's specific reasons.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pandas as pd

ML_IMU_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ML_IMU_ROOT.parent
sys.path.insert(0, str(REPO_ROOT))

from ml_imu.src.predictor import ImuCurlPredictor


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--test_id", type=int, default=None,
                     help="replay only this raw session's rep(s); default replays all 52 labeled reps")
    args = ap.parse_args()

    labels_df = pd.read_csv(ML_IMU_ROOT / "data" / "imu_labels.csv")
    sessions_df = pd.read_csv(ML_IMU_ROOT / "data" / "processed" / "imu_sessions.csv")
    if args.test_id is not None:
        labels_df = labels_df[labels_df.test_id == args.test_id]
        if labels_df.empty:
            raise SystemExit(f"test_id {args.test_id} not found in imu_labels.csv")

    predictor = ImuCurlPredictor()

    print(f"Replaying {len(labels_df)} recorded rep(s) through the trained model "
          f"(NOT a held-out test -- see this script's docstring)...\n")
    correct = 0
    rejected = 0
    for _, row in labels_df.iterrows():
        sess = sessions_df[sessions_df.test_id == row.test_id]
        sess = sess[(sess.frame_idx >= row.start_frame) & (sess.frame_idx <= row.end_frame)]
        sess = sess.sort_values("frame_idx")
        result = predictor.predict_from_arrays(
            sess.flex.to_numpy(), sess.drift.to_numpy(),
            sess.emg.to_numpy(), sess.vib_on.to_numpy(),
        )
        result["true_label"] = row.label
        result["test_id"] = int(row.test_id)
        result["rep_index"] = int(row.rep_index)
        print(json.dumps(result, indent=2))
        if result["prediction"] == "unrecognized_input":
            rejected += 1
            print(f"  -> REJECTED by novelty gate (test_id={row.test_id} rep={row.rep_index}, "
                  f"true label was: {row.label} -- expected for the ~2% most extreme real "
                  f"examples, see novelty_detector_config.json)\n")
        else:
            match = result["prediction"] == row.label
            correct += int(match)
            print(f"  -> {'CORRECT' if match else 'WRONG'} "
                  f"(test_id={row.test_id} rep={row.rep_index}, true label: {row.label})\n")

    classified = len(labels_df) - rejected
    print(f"{correct}/{classified} correct among classified reps, {rejected} rejected by the "
          f"novelty gate, out of {len(labels_df)} total (illustrative only -- not a held-out "
          f"accuracy, see docstring above).")


if __name__ == "__main__":
    main()
