#!/usr/bin/env python3
"""Live dual-sensor demo: runs the vision model, the IMU model, and the
fusion layer together on a real bicep curl -- camera + wearable device
simultaneously.

Setup (run on your own machine -- needs a webcam, a display, and your home
WiFi network the IMU device is on, so it cannot run inside a headless
cloud session, same as ml/scripts/webcam_demo.py):

  pip install mediapipe opencv-python joblib scikit-learn xgboost numpy pandas websockets
  curl -L -o pose_landmarker_lite.task \
    https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task

Then, from the repo root:

  python -m ensemble.scripts.live_ensemble_demo --model pose_landmarker_lite.task --ws-url ws://<device-ip>:<port>/

Controls (focus the video window first):
  s   - start a rep: begin buffering BOTH the camera and the IMU stream
  e   - end the rep: run vision alone, IMU alone, and the fused result,
        and print all three side by side
  q   - quit

IMPORTANT, read before trusting any number this prints: the fusion layer
is UNVALIDATED (see ensemble/README.md) -- there is no synchronized
dual-sensor data to confirm fusing actually helps. Every session you run
through this script IS exactly that kind of data, though -- pass
--save-session to save the raw vision+IMU arrays for this rep (unlabeled;
label it yourself afterward based on what you actually did, the same
discipline already used for ml_imu/'s 35-session dataset) and you're
directly building the validation set this project has been missing.

The IMU device sends JSON over the WebSocket (confirmed) --
ensemble/src/imu_live_client.py tries that first, with the same
plain-text log format the offline Test N.txt files use as a fallback, and
prints the raw message if neither matches (see its module docstring). Watch the
console on first connect for a "[imu_live_client] Detected message
format: ..." line to confirm which one is actually in use.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import uuid
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision

ENSEMBLE_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ENSEMBLE_ROOT.parent
sys.path.insert(0, str(REPO_ROOT))

from ml.src.inference.predictor import BicepCurlPredictor
from ml_imu.src.predictor import ImuCurlPredictor
from ensemble.src.imu_live_client import ImuLiveClient
from ensemble.src.fusion import fuse_predictions

SKELETON_EDGES = [
    (11, 12), (11, 13), (13, 15), (12, 14), (14, 16),
    (11, 23), (12, 24), (23, 24),
]


def draw_skeleton(frame, pose_landmarks, w, h):
    pts = [(int(lm.x * w), int(lm.y * h)) for lm in pose_landmarks]
    for a, b in SKELETON_EDGES:
        cv2.line(frame, pts[a], pts[b], (0, 255, 0), 2)
    for x, y in pts:
        cv2.circle(frame, (x, y), 3, (0, 0, 255), -1)


def save_session(save_dir: Path, vision_keypoints: list, imu_arrays: tuple) -> str:
    """Save one rep's raw dual-sensor data, UNLABELED -- see this script's
    docstring for why no label is auto-assigned."""
    save_dir.mkdir(parents=True, exist_ok=True)
    session_id = f"{time.strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}"
    flex, drift, emg, vib_on = imu_arrays
    np.savez(
        save_dir / f"{session_id}.npz",
        vision_keypoints=np.stack(vision_keypoints) if vision_keypoints else np.empty((0, 33, 3)),
        imu_flex=flex, imu_drift=drift, imu_emg=emg, imu_vib_on=vib_on,
    )
    with open(save_dir / f"{session_id}.meta.json", "w") as f:
        json.dump({"session_id": session_id, "saved_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
                    "label": None, "note": "Unlabeled -- fill in `label` yourself based on "
                                            "what was actually performed in this rep."}, f, indent=2)
    return session_id


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True, help="path to pose_landmarker_lite.task")
    ap.add_argument("--camera", type=int, default=0)
    ap.add_argument("--ws-url", required=True, help="WebSocket URL for the IMU device, e.g. ws://192.168.1.50:81/")
    ap.add_argument("--save-session", default=None,
                     help="directory to save each rep's raw dual-sensor data to (unlabeled)")
    args = ap.parse_args()

    base_options = mp_python.BaseOptions(model_asset_path=args.model)
    options = vision.PoseLandmarkerOptions(
        base_options=base_options, running_mode=vision.RunningMode.VIDEO,
        output_segmentation_masks=False,
    )
    landmarker = vision.PoseLandmarker.create_from_options(options)
    vision_predictor = BicepCurlPredictor()
    imu_predictor = ImuCurlPredictor()

    imu_client = ImuLiveClient(args.ws_url)
    imu_client.connect()

    cap = cv2.VideoCapture(args.camera)
    if not cap.isOpened():
        raise SystemExit(f"Could not open camera index {args.camera}")

    recording = False
    last_result_text = "Press 's' to start a rep"
    start_time = time.time()
    last_timestamp_ms = -1
    vision_keypoints_buffer: list = []

    save_dir = Path(args.save_session) if args.save_session else None

    print("Live ensemble demo running. Focus the video window: 's' start rep, 'e' end rep, 'q' quit.")
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        h, w = frame.shape[:2]

        try:
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            timestamp_ms = int((time.time() - start_time) * 1000)
            if timestamp_ms <= last_timestamp_ms:
                timestamp_ms = last_timestamp_ms + 1
            last_timestamp_ms = timestamp_ms
            result = landmarker.detect_for_video(mp_image, timestamp_ms)

            if result.pose_landmarks:
                draw_skeleton(frame, result.pose_landmarks[0], w, h)
                if recording and result.pose_world_landmarks:
                    vision_predictor.add_frame_from_world_landmarks(result.pose_world_landmarks[0])
                    if save_dir:
                        from ml.src.preprocessing import landmarks as lm
                        vision_keypoints_buffer.append(lm.world_landmarks_to_frame(result.pose_world_landmarks[0]))
        except Exception as exc:  # noqa: BLE001 -- keep the demo alive on any bad frame
            print(f"[frame error, skipped] {exc}")

        key = cv2.waitKey(1) & 0xFF
        if key == ord("s") and not recording:
            print("[s] starting rep...")
            vision_predictor.start_session()
            imu_client.start()
            vision_keypoints_buffer = []
            recording = True
            last_result_text = "Recording rep..."
        elif key == ord("e") and recording:
            print("[e] ending rep, evaluating...")
            recording = False
            imu_flex, imu_drift, imu_emg, imu_vib_on = imu_client.stop()
            try:
                vision_result = vision_predictor.end_session()
            except Exception as exc:  # noqa: BLE001
                print(f"[vision end_session error] {exc}")
                vision_result = {"prediction": None, "error": str(exc)}
            try:
                imu_result = imu_predictor.predict_from_arrays(imu_flex, imu_drift, imu_emg, imu_vib_on) \
                    if len(imu_flex) > 0 else {"prediction": None, "error": "no IMU samples buffered"}
            except Exception as exc:  # noqa: BLE001
                print(f"[imu predict error] {exc}")
                imu_result = {"prediction": None, "error": str(exc)}

            print(f"\n--- VISION ONLY --- ({vision_predictor.num_frames_buffered()} frames)")
            print(json.dumps(vision_result, indent=2))
            print(f"\n--- IMU ONLY --- ({len(imu_flex)} samples)")
            print(json.dumps(imu_result, indent=2))

            fused = None
            if vision_result.get("prediction") is not None and imu_result.get("prediction") is not None:
                fused = fuse_predictions(vision_result, imu_result)
                fused_display = {k: v for k, v in fused.items() if k not in ("vision_result", "imu_result")}
                print(f"\n--- FUSED (source={fused['source']}) ---")
                print(json.dumps(fused_display, indent=2))

            if save_dir:
                session_id = save_session(save_dir, vision_keypoints_buffer,
                                           (imu_flex, imu_drift, imu_emg, imu_vib_on))
                print(f"\n[saved] session {session_id} -> {save_dir} (UNLABELED -- see .meta.json)")

            if fused is not None and fused.get("prediction"):
                if fused.get("good_form_score") is not None:
                    last_result_text = f"FUSED: {fused['good_form_score']:.0%} good form ({fused['prediction']})"
                else:
                    last_result_text = f"FUSED: {fused['prediction']}"
            elif vision_result.get("prediction"):
                last_result_text = f"vision only: {vision_result['prediction']} (IMU unavailable)"
            else:
                last_result_text = "no prediction -- see console"
        elif key == ord("q"):
            print("[q] quitting")
            imu_client.close()
            break

        status = f"REC (vision={vision_predictor.num_frames_buffered()}f, imu={imu_client.num_samples_buffered()}s)" \
            if recording else "idle"
        cv2.putText(frame, f"[{status}] {last_result_text}", (10, 30),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
        cv2.imshow("bicep curl form classifier -- live ensemble", frame)

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
