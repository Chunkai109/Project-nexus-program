#!/usr/bin/env python3
"""Standalone checks for ensemble/src/imu_live_client.py's message-format
auto-detection (matches this project's convention of standalone
scripts/*.py checks, no pytest infra). Does NOT require an actual
WebSocket connection or the `websockets` package -- only exercises the
pure parsing functions.

Run: python -m ensemble.scripts.verify_live_client_parsing
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ENSEMBLE_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ENSEMBLE_ROOT.parent
sys.path.insert(0, str(REPO_ROOT))

from ensemble.src.imu_live_client import try_parse_json, try_parse_log_line


def check(name: str, condition: bool, detail: str = "") -> bool:
    status = "PASS" if condition else "FAIL"
    print(f"  [{status}] {name}" + (f" -- {detail}" if detail else ""))
    return condition


def main():
    all_ok = True

    print("=== JSON message format ===")
    msg = json.dumps({"flex": 2.7, "drift": -1.6, "emg": 1967, "vib": "OFF"})
    result = try_parse_json(msg)
    all_ok &= check("parses a well-formed JSON message with expected keys",
                     result == (2.7, -1.6, 1967.0, False), f"got {result}")
    all_ok &= check("try_parse_log_line correctly rejects a JSON message",
                     try_parse_log_line(msg) is None)

    msg_alias = json.dumps({"Flex": 5.0, "Drift": 2.0, "EMG": 100, "vib_on": True})
    result = try_parse_json(msg_alias)
    all_ok &= check("parses JSON using alternate key names (Flex/Drift/EMG/vib_on)",
                     result == (5.0, 2.0, 100.0, True), f"got {result}")

    msg_missing = json.dumps({"flex": 1.0, "drift": 2.0})
    all_ok &= check("rejects JSON missing required fields (emg, vib)",
                     try_parse_json(msg_missing) is None)

    print("\n=== Plain-text log line format (same as offline Test N.txt files) ===")
    line = "State: DOWN    | Flex:   2.7 | Drift:  -1.6 | EMG: 1967 | Vib: OFF | Reps: 0"
    result = try_parse_log_line(line)
    all_ok &= check("parses a well-formed plain-text log line",
                     result == (2.7, -1.6, 1967.0, False), f"got {result}")
    all_ok &= check("try_parse_json correctly rejects a plain-text log line",
                     try_parse_json(line) is None)

    line_vib_on = "State: TOP | Flex: 150.0 | Drift: 25.0 | EMG: 3000 | Vib: ON | Reps: 1"
    result = try_parse_log_line(line_vib_on)
    all_ok &= check("correctly parses Vib: ON as True",
                     result == (150.0, 25.0, 3000.0, True), f"got {result}")

    print("\n=== Genuinely unrecognized message (neither format) ===")
    garbage = "this is not a real message from anything"
    all_ok &= check("try_parse_json rejects garbage", try_parse_json(garbage) is None)
    all_ok &= check("try_parse_log_line rejects garbage", try_parse_log_line(garbage) is None)
    print("  (ImuLiveClient._handle_message() prints and skips messages like this "
          "rather than crashing -- see its source for the runtime behavior)")

    print(f"\n{'ALL CHECKS PASSED' if all_ok else 'SOME CHECKS FAILED'}")
    if not all_ok:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
