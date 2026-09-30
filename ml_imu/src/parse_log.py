"""Parser for the wearable arm device's raw console-log format.

Each session is a plain-text log with a few startup lines (calibration
messages, "System Ready!", etc.) followed by one line per sample:

    State: DOWN    | Flex:   2.7 | Drift:  -1.6 | EMG: 1967 | Vib: OFF | Reps: 0

`Flex` is a bend-sensor angle proxy for elbow flexion, `Drift` is a
gyro-derived secondary angle (empirically: spikes strongly positive during
elbow flare -- see ml_imu/README.md), `EMG` is raw muscle-activation ADC
counts, `Vib` is the device's own onboard vibration-alert state, `State`/
`Reps` are the device's own (unreliable -- see README) phase/rep tracking.

This is the IMU-pipeline analogue of ml/src/preprocessing/dataset_io.py:
turns raw per-file text into structured per-frame records, with nothing
inferred or guessed -- just a straight parse of what the device logged.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

import numpy as np

LOG_LINE_RE = re.compile(
    r"State:\s*(\S+)\s*\|\s*Flex:\s*([-\d.]+)\s*\|\s*Drift:\s*([-\d.]+)\s*\|\s*"
    r"EMG:\s*(\d+)\s*\|\s*Vib:\s*(\w+)\s*\|\s*Reps:\s*(\d+)"
)

# A reduced format seen in later recording batches (Swing/Incomplete data,
# tests 36+): just "Flex: x.x | Drift: y.y" per line, no State/EMG/Vib/Reps
# at all -- a different (simpler) logging setup than the original device
# firmware used for tests 1-35. Parsed separately rather than guessed at:
# sessions using this format get emg=0 / vib_on=False / state="UNKNOWN" for
# every frame, explicitly marked via `has_emg_vib_state=False` below, so
# nothing downstream mistakes these zeros for a real "no muscle activity"
# reading -- they mean "not recorded," not "recorded as zero."
FLEX_DRIFT_ONLY_RE = re.compile(r"Flex:\s*([-\d.]+)\s*\|\s*Drift:\s*([-\d.]+)")

# Filenames encode the test number inconsistently ("Test 1.txt", "TEST 34.txt").
TEST_NUM_RE = re.compile(r"(\d+)")


@dataclass
class ImuSession:
    test_id: int
    source_filename: str
    state: np.ndarray  # (T,) str
    flex: np.ndarray  # (T,) float
    drift: np.ndarray  # (T,) float
    emg: np.ndarray  # (T,) int
    vib_on: np.ndarray  # (T,) bool
    device_reps: np.ndarray  # (T,) int -- the device's own (unreliable) counter
    has_emg_vib_state: bool = True  # False for the reduced Flex/Drift-only format

    @property
    def num_frames(self) -> int:
        return len(self.flex)


def parse_log_file(path: Path) -> ImuSession:
    """Parse one raw session log into an ImuSession. Tries the full
    State/Flex/Drift/EMG/Vib/Reps format first; if a file has zero matching
    lines under that format, falls back to the reduced Flex/Drift-only
    format (see FLEX_DRIFT_ONLY_RE above) rather than silently returning an
    empty session. Lines that don't match either format (startup/
    calibration messages, headers) are skipped."""
    states, flex, drift, emg, vib, reps = [], [], [], [], [], []
    with open(path) as f:
        lines = f.readlines()

    for line in lines:
        m = LOG_LINE_RE.search(line)
        if not m:
            continue
        s, fl, dr, e, v, r = m.groups()
        states.append(s)
        flex.append(float(fl))
        drift.append(float(dr))
        emg.append(int(e))
        vib.append(v == "ON")
        reps.append(int(r))

    has_emg_vib_state = True
    if not flex:
        has_emg_vib_state = False
        for line in lines:
            m = FLEX_DRIFT_ONLY_RE.search(line)
            if not m:
                continue
            fl, dr = m.groups()
            states.append("UNKNOWN")
            flex.append(float(fl))
            drift.append(float(dr))
            emg.append(0)
            vib.append(False)
            reps.append(0)

    test_num_match = TEST_NUM_RE.search(path.stem)
    if not test_num_match:
        raise ValueError(f"could not extract a test number from filename: {path.name}")

    return ImuSession(
        test_id=int(test_num_match.group(1)),
        source_filename=path.name,
        state=np.array(states, dtype=object),
        flex=np.array(flex, dtype=float),
        drift=np.array(drift, dtype=float),
        emg=np.array(emg, dtype=int),
        vib_on=np.array(vib, dtype=bool),
        device_reps=np.array(reps, dtype=int),
        has_emg_vib_state=has_emg_vib_state,
    )


def load_all_sessions(raw_dir: str | Path) -> list[ImuSession]:
    """Parse every Test*.txt / TEST*.txt file in raw_dir, sorted by test_id."""
    raw_dir = Path(raw_dir)
    paths = sorted(raw_dir.glob("[Tt][Ee][Ss][Tt] *.txt"))
    sessions = [parse_log_file(p) for p in paths]
    sessions.sort(key=lambda s: s.test_id)
    return sessions
