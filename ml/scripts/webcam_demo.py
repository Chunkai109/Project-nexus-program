#!/usr/bin/env python3
"""Live webcam test of the bicep-curl form classifier.

Setup (run on your own machine, with a webcam -- this needs a camera device
and a display, so it cannot run inside a headless cloud session):

  pip install mediapipe opencv-python joblib scikit-learn xgboost numpy pandas
  curl -L -o pose_landmarker_lite.task \
    https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task

Then, from the repo root:

  python -m ml.scripts.webcam_demo --model pose_landmarker_lite.task

Controls (focus the video window first):
  s   - start a rep: begin buffering frames for one curl repetition
  e   - end the rep: run the trained model on everything buffered since 's'
        and show the predicted class + confidence on screen
  q   - quit

Do one full, deliberate bicep curl repetition between pressing 's' and 'e'
-- the model was trained on whole repetitions (~2-3 seconds each in the
training data), not on isolated frames or partial reps.

This uses MediaPipe's newer Tasks API (PoseLandmarker), verified to work
in this project's dev environment; it reads `pose_world_landmarks` (NOT the
default `pose_landmarks`) because that's what the training data was built
from (see src/preprocessing/landmarks.py's module docstring) -- world
landmarks are metric, hip-centered 3D positions.
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import cv2
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision

ML_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ML_ROOT.parent
sys.path.insert(0, str(REPO_ROOT))

from ml.src.inference.predictor import BicepCurlPredictor

# MediaPipe Pose connections relevant to drawing the arm/torso skeleton
# (avoids needing the deprecated `mp.solutions.drawing_utils`).
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True, help="path to pose_landmarker_lite.task")
    ap.add_argument("--camera", type=int, default=0)
    args = ap.parse_args()

    base_options = mp_python.BaseOptions(model_asset_path=args.model)
    options = vision.PoseLandmarkerOptions(
        base_options=base_options,
        running_mode=vision.RunningMode.VIDEO,
        output_segmentation_masks=False,
    )
    landmarker = vision.PoseLandmarker.create_from_options(options)
    predictor = BicepCurlPredictor()

    cap = cv2.VideoCapture(args.camera)
    if not cap.isOpened():
        raise SystemExit(f"Could not open camera index {args.camera}")

    recording = False
    last_result_text = "Press 's' to start a rep"
    start_time = time.time()
    last_timestamp_ms = -1

    print("Webcam demo running. Focus the video window: 's' start rep, 'e' end rep, 'q' quit.")
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        h, w = frame.shape[:2]

        try:
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            # detect_for_video() requires a STRICTLY increasing timestamp on
            # every call. Wall-clock milliseconds can repeat on a fast
            # machine/camera and MediaPipe raises on that -- guard against it
            # rather than letting one repeated millisecond kill the whole loop
            # (this is what silently froze the window mid-recording).
            timestamp_ms = int((time.time() - start_time) * 1000)
            if timestamp_ms <= last_timestamp_ms:
                timestamp_ms = last_timestamp_ms + 1
            last_timestamp_ms = timestamp_ms
            result = landmarker.detect_for_video(mp_image, timestamp_ms)

            if result.pose_landmarks:
                draw_skeleton(frame, result.pose_landmarks[0], w, h)
                if recording and result.pose_world_landmarks:
                    predictor.add_frame_from_world_landmarks(result.pose_world_landmarks[0])
        except Exception as exc:  # noqa: BLE001 -- keep the demo alive on any bad frame
            print(f"[frame error, skipped] {exc}")

        key = cv2.waitKey(1) & 0xFF
        if key == ord("s") and not recording:
            print("[s] starting rep...")
            predictor.start_session()
            recording = True
            last_result_text = "Recording rep..."
        elif key == ord("e") and recording:
            print("[e] ending rep, evaluating...")
            recording = False
            try:
                result_dict = predictor.end_session()
            except Exception as exc:  # noqa: BLE001
                print(f"[end_session error] {exc}")
                last_result_text = f"error: {exc}"
                result_dict = {}
            if result_dict.get("good_form_score") is not None:
                score = result_dict["good_form_score"]
                if result_dict["prediction"] == "Perfect":
                    last_result_text = f"{score:.0%} good form"
                else:
                    last_result_text = f"{score:.0%} good form (likely issue: {result_dict['prediction']})"
                print(result_dict)
            elif result_dict.get("prediction") == "no_exercise_detected":
                last_result_text = "No exercise detected (not enough arm movement)"
                print(result_dict)
            elif result_dict:
                last_result_text = result_dict.get("error", "no prediction")
                print(last_result_text)
        elif key == ord("q"):
            print("[q] quitting")
            break

        status = f"REC ({predictor.num_frames_buffered()} frames)" if recording else "idle"
        cv2.putText(frame, f"[{status}] {last_result_text}", (10, 30),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
        cv2.imshow("bicep curl form classifier", frame)

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
