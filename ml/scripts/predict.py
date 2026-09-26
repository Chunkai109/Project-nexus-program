#!/usr/bin/env python3
"""End-to-end inference demo: replay real held-out TEST recordings frame by
frame through BicepCurlPredictor exactly as a live camera loop would, and
print the resulting prediction. This is not a theoretical example -- it
runs the actual trained model against actual data the model never saw
during training or model selection.

Usage:
  python -m ml.scripts.predict --csv /path/to/reduced.csv [--video_id vid_0003_orig]

With no --video_id, predicts one example from each TEST-split source
recording's original clip.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ML_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ML_ROOT.parent
sys.path.insert(0, str(REPO_ROOT))

from ml.src.preprocessing.dataset_io import load_all_sequences
from ml.src.inference.predictor import BicepCurlPredictor

PROCESSED_DIR = ML_ROOT / "data" / "processed"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True)
    ap.add_argument("--video_id", default=None)
    args = ap.parse_args()

    with open(PROCESSED_DIR / "base_id_split.json") as f:
        split = json.load(f)
    test_base_ids = set(split["test"])

    sequences = load_all_sequences(args.csv)
    if args.video_id:
        targets = [s for s in sequences if s.video_id == args.video_id]
        if not targets:
            raise SystemExit(f"video_id {args.video_id!r} not found in CSV")
    else:
        targets = [s for s in sequences if s.is_original and s.base_id in test_base_ids]

    predictor = BicepCurlPredictor()

    print(f"Running live-style streaming inference on {len(targets)} recording(s) "
          f"the model never saw during training or model selection...\n")
    correct = 0
    for seq in targets:
        # use_wallclock_duration=False: these frames are replayed from the
        # CSV instantly, not paced in real time, so wall-clock elapsed time
        # is meaningless here -- the raw recorded frame count is correct.
        predictor.start_session(use_wallclock_duration=False)
        for frame in seq.keypoints:
            predictor.add_frame_from_array(frame)
        result = predictor.end_session()
        result["true_label"] = seq.class_label
        result["video_id"] = seq.video_id
        match = result["prediction"] == seq.class_label
        correct += int(match)
        print(json.dumps(result, indent=2))
        print(f"  -> {'CORRECT' if match else 'WRONG'} (true label: {seq.class_label})\n")

    print(f"{correct}/{len(targets)} correct on this demo run.")


if __name__ == "__main__":
    main()
