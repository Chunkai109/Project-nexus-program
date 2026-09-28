"""Live WebSocket client for the wearable IMU/EMG device.

The device connects over WiFi via WebSocket and sends **JSON** messages
(confirmed with the device's own developer). Each incoming message is
tried as JSON first -- the expected, confirmed path -- and falls back to
the same plain-text log-line format the offline `Test N.txt` files use
(`ml_imu.src.parse_log.LOG_LINE_RE`, reused directly -- not duplicated)
only as a safety net in case a firmware update or a different device ever
sends the older plain-text format instead. A message matching neither is
printed raw and skipped rather than crashing the client.

Runs its own asyncio event loop in a background daemon thread, so it can
be driven from a plain synchronous script (mirroring
`ml/scripts/webcam_demo.py`'s while-loop style) without the caller having
to manage asyncio directly.
"""
from __future__ import annotations

import asyncio
import json
import sys
import threading
from pathlib import Path

import numpy as np

ML_IMU_ROOT = Path(__file__).resolve().parents[2] / "ml_imu"
if str(ML_IMU_ROOT.parent) not in sys.path:
    sys.path.insert(0, str(ML_IMU_ROOT.parent))

from ml_imu.src.parse_log import LOG_LINE_RE

# A few reasonable key-name variants for the JSON case -- the actual key
# names the device uses aren't confirmed; extend this if the real device
# uses something not listed here (the raw-message printout on an
# unrecognized format will show you what to add).
JSON_KEY_ALIASES = {
    "flex": ["flex", "Flex", "flex_deg", "flexion"],
    "drift": ["drift", "Drift"],
    "emg": ["emg", "EMG"],
    "vib": ["vib", "Vib", "vib_on", "vibration"],
}


def try_parse_json(message: str):
    """Return (flex, drift, emg, vib_on) if `message` is a JSON object
    containing all four expected fields (under any of their known key
    aliases), else None."""
    try:
        obj = json.loads(message)
    except (json.JSONDecodeError, TypeError):
        return None
    if not isinstance(obj, dict):
        return None

    values = {}
    for field_name, aliases in JSON_KEY_ALIASES.items():
        for alias in aliases:
            if alias in obj:
                values[field_name] = obj[alias]
                break
        else:
            return None  # this field is missing under every known alias

    try:
        flex = float(values["flex"])
        drift = float(values["drift"])
        emg = float(values["emg"])
        vib_raw = values["vib"]
        vib_on = (vib_raw.strip().upper() in ("ON", "TRUE", "1")
                  if isinstance(vib_raw, str) else bool(vib_raw))
    except (TypeError, ValueError):
        return None
    return flex, drift, emg, vib_on


def try_parse_log_line(message: str):
    """Return (flex, drift, emg, vib_on) if `message` matches the same
    plain-text log line format as the offline Test N.txt files, else
    None."""
    m = LOG_LINE_RE.search(message)
    if not m:
        return None
    _state, flex, drift, emg, vib, _reps = m.groups()
    return float(flex), float(drift), float(emg), vib == "ON"


class ImuLiveClient:
    """Background WebSocket client buffering live IMU samples between
    start() and stop() calls, mirroring BicepCurlPredictor's
    start_session()/end_session() buffering style."""

    def __init__(self, ws_url: str):
        self.ws_url = ws_url
        self._lock = threading.Lock()
        self._buffer: list[tuple[float, float, float, bool]] = []
        self._recording = False
        self._detected_format: str | None = None
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._connected_event = threading.Event()
        self._connect_error: Exception | None = None

    def connect(self, timeout: float = 10.0) -> None:
        """Start the background connection. Blocks briefly to confirm the
        connection attempt resolved (success or failure), then returns --
        the actual message loop keeps running in the background thread."""
        self._thread = threading.Thread(target=self._run_loop, daemon=True)
        self._thread.start()
        if not self._connected_event.wait(timeout=timeout):
            print(f"[imu_live_client] WARNING: no connection confirmation from "
                  f"{self.ws_url} within {timeout:.0f}s")
        elif self._connect_error is not None:
            print(f"[imu_live_client] WARNING: connection to {self.ws_url} failed: "
                  f"{self._connect_error}")
        else:
            print(f"[imu_live_client] Connected to {self.ws_url}")

    def _run_loop(self) -> None:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        loop.run_until_complete(self._connect_and_listen())

    async def _connect_and_listen(self) -> None:
        import websockets  # imported here so the module still imports
                            # cleanly (e.g. for unit-testing the parsers
                            # above) even if `websockets` isn't installed
        try:
            async with websockets.connect(self.ws_url) as ws:
                self._connected_event.set()
                async for message in ws:
                    if self._stop_event.is_set():
                        break
                    self._handle_message(message)
        except Exception as exc:  # noqa: BLE001 -- report, don't crash the caller
            self._connect_error = exc
            self._connected_event.set()

    def _handle_message(self, message) -> None:
        if isinstance(message, bytes):
            try:
                message = message.decode("utf-8")
            except UnicodeDecodeError:
                return

        parsed = try_parse_json(message)
        fmt = "json"
        if parsed is None:
            parsed = try_parse_log_line(message)
            fmt = "plain_text_log"
        if parsed is None:
            print(f"[imu_live_client] Unrecognized message format, skipping: {message!r}")
            return

        if self._detected_format is None:
            self._detected_format = fmt
            print(f"[imu_live_client] Detected message format: {fmt}")

        if self._recording:
            with self._lock:
                self._buffer.append(parsed)

    def start(self) -> None:
        with self._lock:
            self._buffer = []
        self._recording = True

    def stop(self):
        """Stop buffering and return (flex, drift, emg, vib_on) arrays."""
        self._recording = False
        with self._lock:
            samples = list(self._buffer)
        if not samples:
            empty = np.array([])
            return empty, empty, empty, np.array([], dtype=bool)
        flex, drift, emg, vib = zip(*samples)
        return (np.array(flex), np.array(drift), np.array(emg), np.array(vib, dtype=bool))

    def num_samples_buffered(self) -> int:
        with self._lock:
            return len(self._buffer)

    def close(self) -> None:
        self._stop_event.set()
