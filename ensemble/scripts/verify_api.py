#!/usr/bin/env python3
"""Standalone checks for ensemble/api/server.py (matches this project's
convention of standalone scripts/*.py checks, no pytest infra). Uses
FastAPI's TestClient -- no server needs to be running, no network calls.

Run: python -m ensemble.scripts.verify_api --csv /path/to/bicep_with_incomplete.csv
"""
from __future__ import annotations

import sys
from pathlib import Path

ENSEMBLE_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ENSEMBLE_ROOT.parent
sys.path.insert(0, str(REPO_ROOT))

from fastapi.testclient import TestClient
from ensemble.api.server import app


def check(name: str, condition: bool, detail: str = "") -> bool:
    status = "PASS" if condition else "FAIL"
    print(f"  [{status}] {name}" + (f" -- {detail}" if detail else ""))
    return condition


def main():
    client = TestClient(app)
    all_ok = True

    print("=== /health ===")
    r = client.get("/health")
    all_ok &= check("returns 200 with status ok", r.status_code == 200 and r.json().get("status") == "ok",
                     f"got {r.status_code} {r.json()}")

    print("\n=== /predict input validation (no real data needed) ===")
    frame = [[0.0, 0.0, 0.0]] * 33
    r = client.post("/predict", json={"vision": {"frames": [[[1, 2]]], "duration_seconds": 1.0},
                                        "imu": {"flex": [1.0] * 10, "drift": [1.0] * 10,
                                                "emg": [1.0] * 10, "vib_on": [False] * 10}})
    all_ok &= check("rejects wrong frame shape with 400", r.status_code == 400, f"got {r.status_code}")

    r = client.post("/predict", json={"vision": {"frames": [frame] * 3, "duration_seconds": 1.0},
                                        "imu": {"flex": [1.0] * 10, "drift": [1.0] * 10,
                                                "emg": [1.0] * 10, "vib_on": [False] * 10}})
    all_ok &= check("rejects too few vision frames with 400", r.status_code == 400, f"got {r.status_code}")

    r = client.post("/predict", json={"vision": {"frames": [frame] * 20, "duration_seconds": 1.0},
                                        "imu": {"flex": [], "drift": [], "emg": [], "vib_on": []}})
    all_ok &= check("rejects empty IMU arrays with 400", r.status_code == 400, f"got {r.status_code}")

    r = client.post("/predict", json={"vision": {"frames": [frame] * 20, "duration_seconds": 1.0},
                                        "imu": {"flex": [1.0] * 5, "drift": [1.0] * 10,
                                                "emg": [1.0] * 10, "vib_on": [False] * 10}})
    all_ok &= check("rejects mismatched IMU array lengths with 400", r.status_code == 400, f"got {r.status_code}")

    if "--csv" in sys.argv:
        print("\n=== /predict with real data ===")
        csv_path = sys.argv[sys.argv.index("--csv") + 1]
        from ml.src.preprocessing.dataset_io import load_all_sequences
        import pandas as pd

        sequences = load_all_sequences(csv_path)
        vision_seq = next(s for s in sequences if s.is_original and s.class_label == "Perfect")
        frames_real = vision_seq.keypoints.tolist()

        labels_df = pd.read_csv(ENSEMBLE_ROOT.parent / "ml_imu" / "data" / "imu_labels.csv")
        sessions_df = pd.read_csv(ENSEMBLE_ROOT.parent / "ml_imu" / "data" / "processed" / "imu_sessions.csv")
        row = labels_df[labels_df.label == "Half"].iloc[0]
        sess = sessions_df[sessions_df.test_id == row.test_id]
        sess = sess[(sess.frame_idx >= row.start_frame) & (sess.frame_idx <= row.end_frame)].sort_values("frame_idx")

        payload = {
            "vision": {"frames": frames_real, "duration_seconds": 3.0},
            "imu": {"flex": sess.flex.tolist(), "drift": sess.drift.tolist(),
                    "emg": sess.emg.tolist(), "vib_on": sess.vib_on.tolist()},
        }
        r = client.post("/predict", json=payload)
        all_ok &= check("real request returns 200", r.status_code == 200, f"got {r.status_code}")
        body = r.json()
        print(f"  response: prediction={body.get('prediction')} source={body.get('source')} "
              f"good_form_score={body.get('good_form_score')}")
        all_ok &= check("response has exactly ONE prediction field (not separate vision/imu predictions)",
                         "prediction" in body and "vision_result" not in body and "imu_result" not in body,
                         f"keys={sorted(body.keys())}")
        all_ok &= check("class_probabilities sums to 1", abs(sum(body["class_probabilities"].values()) - 1.0) < 1e-6)

        r_debug = client.post("/predict?debug=true", json=payload)
        body_debug = r_debug.json()
        all_ok &= check("?debug=true adds a 'details' field with both raw results",
                         "details" in body_debug and "vision_result" in body_debug["details"]
                         and "imu_result" in body_debug["details"])
        all_ok &= check("non-debug response still has no 'details' field",
                         "details" not in body)
    else:
        print("\n[skip] pass --csv /path/to/bicep_with_incomplete.csv to test /predict with real data")

    print(f"\n{'ALL CHECKS PASSED' if all_ok else 'SOME CHECKS FAILED'}")
    if not all_ok:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
