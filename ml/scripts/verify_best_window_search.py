#!/usr/bin/env python3
"""Standalone checks for BicepCurlPredictor's best-window search
(src/inference/predictor.py's _end_session_with_window_search), added so
live inference no longer scores the ENTIRE buffered session as one
repetition -- which made total capture duration itself a dominant,
misleading feature (see ml/README.md's "Duration-independent live
inference" section). Matches this repo's convention of standalone
scripts/*.py checks (no pytest infra exists here).

Run: python -m ml.scripts.verify_best_window_search --csv /path/to/bicep_with_incomplete.csv

Checks:
  1. Regression: the CSV-replay / recorded-sequence path
     (use_wallclock_duration=False, scripts/predict.py's exact code path)
     is untouched by this change -- num_frames always equals the input
     length exactly (no windowing applied) and no best-window metadata
     appears in its result.
  2. A real TEST-split "Perfect" recording padded with idle frames before
     and after (simulating "the user took too long") recovers the same
     prediction, with a good_form_score close to the unpadded baseline,
     once run through the live/window-search path.
  3. Performance: one end_session() call over a realistic padded buffer
     completes quickly.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np

ML_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ML_ROOT.parent
sys.path.insert(0, str(REPO_ROOT))

from ml.src.preprocessing.dataset_io import load_all_sequences
from ml.src.inference.predictor import BicepCurlPredictor
import ml.src.inference.predictor as predictor_module


def check(name: str, condition: bool, detail: str = "") -> bool:
    status = "PASS" if condition else "FAIL"
    print(f"  [{status}] {name}" + (f" -- {detail}" if detail else ""))
    return condition


def run_single_shot(predictor: BicepCurlPredictor, frames: np.ndarray) -> dict:
    """Exactly mirrors predict_full_sequence() / scripts/predict.py: the
    unmodified use_wallclock_duration=False code path."""
    return predictor.predict_full_sequence(frames)


def run_live_session(predictor: BicepCurlPredictor, frames: np.ndarray, assumed_fps: float) -> dict:
    """Simulate a live session with a controlled, reproducible duration by
    monkey-patching time.time() inside the predictor module -- this drives
    the REAL public start_session()/add_frame_from_array()/end_session()
    path (not a private method), just without depending on real sleep.
    """
    fake_duration = len(frames) / assumed_fps
    fake_now = {"t": 1_000_000.0}
    real_time_fn = predictor_module.time.time
    predictor_module.time.time = lambda: fake_now["t"]
    try:
        predictor.start_session(use_wallclock_duration=True)
        for frame in frames:
            predictor.add_frame_from_array(frame)
        fake_now["t"] += fake_duration
        return predictor.end_session()
    finally:
        predictor_module.time.time = real_time_fn


def main():
    if "--csv" not in sys.argv:
        raise SystemExit("usage: verify_best_window_search.py --csv /path/to/bicep_with_incomplete.csv")
    csv_path = sys.argv[sys.argv.index("--csv") + 1]

    sequences = load_all_sequences(csv_path)
    predictor = BicepCurlPredictor()

    with open(ML_ROOT / "data" / "processed" / "base_id_split.json") as f:
        split = json.load(f)
    test_base_ids = set(split["test"])

    test_orig = [s for s in sequences if s.is_original and s.base_id in test_base_ids]
    if not test_orig:
        raise SystemExit("no TEST-split original sequences found in this CSV")

    all_ok = True

    print("=== Regression: CSV-replay (use_wallclock_duration=False) path unchanged ===")
    for seq in test_orig:
        result = run_single_shot(predictor, seq.keypoints)
        all_ok &= check(f"{seq.video_id}: num_frames matches input length exactly (no windowing applied)",
                         result.get("num_frames") == seq.num_frames,
                         f"num_frames={result.get('num_frames')} vs input={seq.num_frames}")
        all_ok &= check(f"{seq.video_id}: reports no wall-clock duration",
                         result.get("duration_seconds") is None,
                         f"duration_seconds={result.get('duration_seconds')}")
        all_ok &= check(f"{seq.video_id}: no best-window metadata present",
                         "best_window_start_seconds" not in result,
                         f"keys={sorted(result.keys())}")

    perfect_seq = next((s for s in test_orig if s.class_label == "Perfect"), None)
    if perfect_seq is not None:
        print(f"\n=== Padding robustness check (source: {perfect_seq.video_id}) ===")
        baseline = run_single_shot(predictor, perfect_seq.keypoints)
        print(f"  unpadded single-shot: prediction={baseline.get('prediction')} "
              f"good_form_score={baseline.get('good_form_score')}")

        # Pad with idle (first-frame-repeated) frames before and after --
        # simulates a user who takes much longer than the training clip,
        # without truncating any of the real repetition itself.
        idle_frame = perfect_seq.keypoints[0]
        pad_before = np.repeat(idle_frame[None, :, :], 150, axis=0)
        pad_after = np.repeat(idle_frame[None, :, :], 150, axis=0)
        padded = np.concatenate([pad_before, perfect_seq.keypoints, pad_after], axis=0)

        # Simulate a live session where the whole padded capture took 12
        # seconds ("took too long") at a live fps consistent with that.
        assumed_fps = len(padded) / 12.0
        windowed = run_live_session(predictor, padded, assumed_fps)
        print(f"  padded + window-search: prediction={windowed.get('prediction')} "
              f"good_form_score={windowed.get('good_form_score')} "
              f"best_window=[{windowed.get('best_window_start_seconds', float('nan')):.2f}, "
              f"{windowed.get('best_window_end_seconds', float('nan')):.2f}]s "
              f"of {windowed.get('total_capture_seconds', float('nan')):.2f}s "
              f"({windowed.get('num_windows_evaluated', '?')} windows evaluated)")

        all_ok &= check("padded session recovers the same predicted class as the unpadded original",
                         windowed.get("prediction") == baseline.get("prediction"),
                         f"windowed={windowed.get('prediction')} vs baseline={baseline.get('prediction')}")
        baseline_score = baseline.get("good_form_score") or 0.0
        windowed_score = windowed.get("good_form_score") or 0.0
        all_ok &= check("padded session's good_form_score is close to the unpadded baseline "
                         "(not tanked by the padding)",
                         windowed_score >= baseline_score - 0.15,
                         f"windowed={windowed_score:.3f} vs baseline={baseline_score:.3f}")
    else:
        print("\n[skip] no TEST-split 'Perfect' original sequence found for the padding check")
        perfect_seq = test_orig[0]

    print("\n=== Performance check ===")
    long_seq = max(test_orig, key=lambda s: s.num_frames)
    idle_frame = long_seq.keypoints[0]
    padded_long = np.concatenate([
        np.repeat(idle_frame[None, :, :], 200, axis=0),
        long_seq.keypoints,
        np.repeat(idle_frame[None, :, :], 200, axis=0),
    ], axis=0)
    assumed_fps = len(padded_long) / 15.0
    t0 = time.perf_counter()
    result = run_live_session(predictor, padded_long, assumed_fps)
    elapsed = time.perf_counter() - t0
    all_ok &= check(f"window search over a {len(padded_long)}-frame buffer completes quickly",
                     elapsed < 2.0,
                     f"elapsed={elapsed:.3f}s, num_windows_evaluated={result.get('num_windows_evaluated')}")

    print(f"\n{'ALL CHECKS PASSED' if all_ok else 'SOME CHECKS FAILED'}")
    if not all_ok:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
