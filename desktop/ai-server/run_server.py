"""Entry point for the bundled AI form-check server inside the desktop app.

The Electron app starts this (as the PyInstaller-built smartphysio-ai
executable) with a free port, and closes its stdin pipe when it exits. We
shut down on stdin EOF, so the server never outlives the app, even if the
app crashes instead of quitting cleanly.
"""
from __future__ import annotations

import argparse
import os
import sys
import threading
from pathlib import Path

if not getattr(sys, "frozen", False):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import uvicorn

from ensemble.api.server import app


def _exit_when_parent_closes_stdin() -> None:
    try:
        sys.stdin.read()
    finally:
        os._exit(0)


def main() -> None:
    parser = argparse.ArgumentParser(description="SmartPhysio AI form-check server")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument(
        "--exit-on-stdin-close",
        action="store_true",
        help="Shut down when stdin closes (set by the desktop app).",
    )
    args = parser.parse_args()

    if args.exit_on_stdin_close:
        threading.Thread(target=_exit_when_parent_closes_stdin, daemon=True).start()

    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
