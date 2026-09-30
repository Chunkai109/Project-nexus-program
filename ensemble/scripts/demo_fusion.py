#!/usr/bin/env python3
"""Standalone checks for ensemble/src/fusion.py (matches this project's
convention of standalone scripts/*.py checks, no pytest infra).

LEADING CAVEAT: this script verifies the fusion LOGIC is correct. It does
NOT and CANNOT validate that fusing actually improves real-world accuracy
-- no synchronized dual-sensor recording exists. See ensemble/README.md.

Usage: python -m ensemble.scripts.demo_fusion --csv /path/to/bicep_with_incomplete.csv
"""
from __future__ import annotations

import sys
from pathlib import Path

ENSEMBLE_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ENSEMBLE_ROOT.parent
sys.path.insert(0, str(REPO_ROOT))

from ensemble.src.fusion import fuse_predictions, SHARED_CLASSES, VISION_EXCLUSIVE_CLASSES


def check(name: str, condition: bool, detail: str = "") -> bool:
    status = "PASS" if condition else "FAIL"
    print(f"  [{status}] {name}" + (f" -- {detail}" if detail else ""))
    return condition


def mock_vision_result(prediction: str, proba: dict, good_form_score=None,
                        good_form_score_raw=None) -> dict:
    return {
        "exercise": "bicep_curl", "prediction": prediction,
        "confidence": proba.get(prediction) if proba else None,
        "good_form_score": good_form_score, "good_form_score_raw": good_form_score_raw,
        "class_probabilities": proba, "num_frames": 60,
    }


def mock_imu_result(prediction: str, proba: dict) -> dict:
    return {
        "exercise": "bicep_curl", "prediction": prediction,
        "confidence": proba.get(prediction) if proba else None,
        "class_probabilities": proba, "num_frames": 40,
    }


def main():
    print("=" * 70)
    print("PART 1: Logic/correctness tests on hand-constructed mock dicts")
    print("(these test the fusion CODE, not real-world accuracy)")
    print("=" * 70)
    all_ok = True

    # --- Branch 1: vision gate rejection takes priority ---
    vision_rejected = mock_vision_result("no_exercise_detected", {})
    imu_confident = mock_imu_result(
        "Perfect", {"Perfect": 0.85, "Drag": 0.05, "Swing": 0.03, "Half": 0.03, "Heave": 0.02, "Incomplete": 0.02})
    result = fuse_predictions(vision_rejected, imu_confident)
    all_ok &= check("vision gate rejection short-circuits even a confident IMU opinion",
                     result["source"] == "rejected_by_vision_gate" and result["prediction"] == "no_exercise_detected",
                     f"got source={result['source']}, prediction={result['prediction']}")

    # --- Branch 2: IMU gate rejection, vision confident ---
    vision_confident = mock_vision_result(
        "Perfect", {"Perfect": 0.5, "Drag": 0.1, "Swing": 0.1, "Half": 0.1, "Heave": 0.1, "Incomplete": 0.1},
        good_form_score=0.9, good_form_score_raw=0.5,
    )
    imu_rejected = mock_imu_result("unrecognized_input", {})
    result = fuse_predictions(vision_confident, imu_rejected)
    all_ok &= check("IMU gate rejection short-circuits even a confident vision opinion",
                     result["source"] == "rejected_by_imu_gate" and result["prediction"] == "unrecognized_input",
                     f"got source={result['source']}, prediction={result['prediction']}")

    # --- Branch 3: vision's top class is Swing -- now fused, not bypassed ---
    # Swing used to be a VISION_EXCLUSIVE_CLASS (IMU had zero training data
    # for it), so this used to assert a vision-only bypass. A second
    # data-collection batch gave IMU real (if thin) Swing data, so
    # VISION_EXCLUSIVE_CLASSES is now empty and Swing fuses like any other
    # shared class -- this branch checks that it does, not that it's
    # bypassed (the bypass mechanism itself has no reachable class to
    # exercise today; see fusion.py's VISION_EXCLUSIVE_CLASSES docstring).
    vision_swing = mock_vision_result(
        "Swing", {"Perfect": 0.1, "Drag": 0.05, "Swing": 0.6, "Half": 0.1, "Heave": 0.1, "Incomplete": 0.05},
        good_form_score=0.11, good_form_score_raw=0.06,
    )
    result = fuse_predictions(vision_swing, imu_confident)
    all_ok &= check("vision's Swing top prediction is fused with IMU's opinion, not bypassed",
                     result["source"] == "fused",
                     f"got source={result['source']}, prediction={result['prediction']}")
    all_ok &= check("fused result still carries both raw per-model results for transparency",
                     result.get("imu_result") == imu_confident and result.get("vision_result") == vision_swing)

    # --- Branch 4: real fusion over shared classes, hand-verified math ---
    vision_shared_case = mock_vision_result(
        "Perfect", {"Perfect": 0.6, "Drag": 0.1, "Swing": 0.05, "Half": 0.15, "Heave": 0.05, "Incomplete": 0.05},
        good_form_score=1.0, good_form_score_raw=0.6,
    )
    imu_shared_case = mock_imu_result(
        "Half", {"Perfect": 0.2, "Drag": 0.1, "Swing": 0.05, "Half": 0.5, "Heave": 0.1, "Incomplete": 0.05})
    result = fuse_predictions(vision_shared_case, imu_shared_case, vision_weight=0.8)
    # Hand-computed expected values: SHARED_CLASSES is now all 6 classes and
    # both mocks already sum to 1 over all 6, so no mass is dropped or
    # renormalized (unlike when Swing/Incomplete were vision-exclusive) --
    # fused = 0.8*vision + 0.2*imu, per class.
    expected_perfect = 0.8 * 0.6 + 0.2 * 0.2
    expected_half = 0.8 * 0.15 + 0.2 * 0.5
    all_ok &= check("fused source is 'fused' for a normal shared-class case",
                     result["source"] == "fused", f"got source={result['source']}")
    all_ok &= check("fused P(Perfect) matches hand-computed expected value",
                     abs(result["class_probabilities"]["Perfect"] - expected_perfect) < 1e-6,
                     f"got {result['class_probabilities']['Perfect']:.6f}, expected {expected_perfect:.6f}")
    all_ok &= check("fused P(Half) matches hand-computed expected value",
                     abs(result["class_probabilities"]["Half"] - expected_half) < 1e-6,
                     f"got {result['class_probabilities']['Half']:.6f}, expected {expected_half:.6f}")
    all_ok &= check("fused class_probabilities sum to 1 over the 6 shared classes",
                     abs(sum(result["class_probabilities"].values()) - 1.0) < 1e-9,
                     f"sum={sum(result['class_probabilities'].values()):.9f}")
    all_ok &= check("fused prediction is the argmax of the fused probabilities",
                     result["prediction"] == max(result["class_probabilities"],
                                                  key=result["class_probabilities"].get))
    all_ok &= check("SHARED_CLASSES/VISION_EXCLUSIVE_CLASSES partition all 6 vision classes",
                     set(SHARED_CLASSES) | set(VISION_EXCLUSIVE_CLASSES) ==
                     set(vision_shared_case["class_probabilities"].keys()))

    print(f"\n{'=' * 70}")
    print("PART 2: Plumbing smoke test with REAL model outputs")
    print("(proves the code runs against real dict shapes -- the vision rep")
    print(" and IMU rep below are from UNRELATED real-world events, so this")
    print(" pairing is arbitrary and proves nothing about fusion quality)")
    print("=" * 70)

    if "--csv" in sys.argv:
        csv_path = sys.argv[sys.argv.index("--csv") + 1]
        from ml.src.preprocessing.dataset_io import load_all_sequences
        from ml.src.inference.predictor import BicepCurlPredictor
        from ml_imu.src.predictor import ImuCurlPredictor
        import json
        import pandas as pd

        sequences = load_all_sequences(csv_path)
        vision_seq = next(s for s in sequences if s.is_original)
        vision_predictor = BicepCurlPredictor()
        real_vision_result = vision_predictor.predict_full_sequence(vision_seq.keypoints)
        print(f"Real vision result (from {vision_seq.video_id}): "
              f"prediction={real_vision_result.get('prediction')}")

        labels_df = pd.read_csv(ENSEMBLE_ROOT.parent / "ml_imu" / "data" / "imu_labels.csv")
        sessions_df = pd.read_csv(ENSEMBLE_ROOT.parent / "ml_imu" / "data" / "processed" / "imu_sessions.csv")
        row = labels_df.iloc[0]
        sess = sessions_df[sessions_df.test_id == row.test_id]
        sess = sess[(sess.frame_idx >= row.start_frame) & (sess.frame_idx <= row.end_frame)].sort_values("frame_idx")
        imu_predictor = ImuCurlPredictor()
        real_imu_result = imu_predictor.predict_from_arrays(
            sess.flex.to_numpy(), sess.drift.to_numpy(), sess.emg.to_numpy(), sess.vib_on.to_numpy(),
        )
        print(f"Real IMU result (from test_id={row.test_id}, rep={row.rep_index}): "
              f"prediction={real_imu_result.get('prediction')}")

        fused = fuse_predictions(real_vision_result, real_imu_result)
        print(f"\nFused result: {json.dumps({k: v for k, v in fused.items() if k not in ('vision_result', 'imu_result')}, indent=2)}")
        all_ok &= check("plumbing smoke test ran end-to-end without errors", True)
    else:
        print("[skip] pass --csv /path/to/bicep_with_incomplete.csv to run the plumbing smoke test")

    print(f"\n{'ALL CHECKS PASSED' if all_ok else 'SOME CHECKS FAILED'}")
    if not all_ok:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
