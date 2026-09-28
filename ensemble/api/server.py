"""FastAPI backend exposing the vision + IMU fusion model to a web
frontend as ONE prediction endpoint.

By design, the caller (frontend) never sees "vision's answer" and "IMU's
answer" as two separate things to reconcile -- this returns a single
fused result. The individual per-model results are still computed
internally (fuse_predictions() needs them) and are available under
`"details"` only if requested with `?debug=true`, for inspection/
debugging -- never as the primary response shape.

Setup (run on a machine that can serve the frontend -- this doesn't need
a camera or the IMU device itself, only the already-trained model files
committed in ml/models/best_model/ and ml_imu/models/best_model/):

    pip install -r ensemble/api/requirements.txt
    uvicorn ensemble.api.server:app --reload --port 8000

Then POST to http://localhost:8000/predict -- see PredictRequest below
for the exact request shape, and ensemble/README.md's API section for a
worked curl example.

IMPORTANT, read before trusting any number this returns: the fusion
layer is UNVALIDATED (see ensemble/README.md) -- no synchronized
dual-sensor data exists to confirm fusing improves on vision alone. This
API makes the model easier to *call*, not more *validated*.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

ENSEMBLE_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ENSEMBLE_ROOT.parent
sys.path.insert(0, str(REPO_ROOT))

from ml.src.inference.predictor import BicepCurlPredictor, MIN_FRAMES_FOR_PREDICTION
from ml_imu.src.predictor import ImuCurlPredictor
from ensemble.src.fusion import fuse_predictions

app = FastAPI(
    title="Bicep Curl Fusion API",
    description="One fused prediction from the vision (MediaPipe Pose) and IMU/EMG models. "
                 "See ensemble/README.md and ensemble/FUSION_MODEL_SUMMARY.md for the full picture, "
                 "especially the accuracy caveats before showing any number to an end user.",
)

# Permissive for local development (the frontend dev server runs on a
# different origin/port than this API). Tighten this to the actual
# frontend origin(s) before deploying anywhere real.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Loaded once at startup, not per-request -- both predictors load model
# files from disk and are safe to reuse across requests (each call to
# start_session()/predict_from_arrays() resets any per-call state).
_vision_predictor = BicepCurlPredictor()
_imu_predictor = ImuCurlPredictor()


class VisionInput(BaseModel):
    frames: list[list[list[float]]] = Field(
        ..., description="Buffered MediaPipe Pose world landmarks for one rep: "
                          "a list of T frames, each frame a list of 33 [x, y, z] landmarks, "
                          "in ml.src.preprocessing.landmarks.MEDIAPIPE_LANDMARK_NAMES order.")
    duration_seconds: float = Field(
        ..., gt=0, description="Real elapsed time (seconds) the browser measured between "
                                "starting and stopping the recording -- NOT derived from the "
                                "number of frames. Required for the vision model's best-window "
                                "search to work correctly (see BicepCurlPredictor.end_session's "
                                "duration_seconds_override docstring).")


class ImuInput(BaseModel):
    flex: list[float]
    drift: list[float]
    emg: list[float]
    vib_on: list[bool]


class PredictRequest(BaseModel):
    vision: VisionInput
    imu: ImuInput


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/predict")
def predict(request: PredictRequest, debug: bool = False):
    frames = np.array(request.vision.frames, dtype=float)
    if frames.ndim != 3 or frames.shape[1:] != (33, 3):
        raise HTTPException(
            400, f"vision.frames must have shape (T, 33, 3); got {frames.shape}. "
                 f"Each frame needs all 33 MediaPipe Pose world landmarks.")
    if len(frames) < MIN_FRAMES_FOR_PREDICTION:
        raise HTTPException(
            400, f"vision.frames has {len(frames)} frames; need at least "
                 f"{MIN_FRAMES_FOR_PREDICTION} to classify.")

    flex = np.array(request.imu.flex, dtype=float)
    drift = np.array(request.imu.drift, dtype=float)
    emg = np.array(request.imu.emg, dtype=float)
    vib_on = np.array(request.imu.vib_on, dtype=bool)
    if not (len(flex) == len(drift) == len(emg) == len(vib_on)):
        raise HTTPException(
            400, f"imu.flex/drift/emg/vib_on must all be the same length; got "
                 f"{len(flex)}/{len(drift)}/{len(emg)}/{len(vib_on)}.")
    if len(flex) == 0:
        raise HTTPException(400, "imu.flex (and drift/emg/vib_on) must be non-empty.")

    _vision_predictor.start_session(use_wallclock_duration=True)
    for frame in frames:
        _vision_predictor.add_frame_from_array(frame)
    vision_result = _vision_predictor.end_session(
        duration_seconds_override=request.vision.duration_seconds)

    imu_result = _imu_predictor.predict_from_arrays(flex, drift, emg, vib_on)

    fused = fuse_predictions(vision_result, imu_result)

    response = {k: v for k, v in fused.items() if k not in ("vision_result", "imu_result")}
    if debug:
        response["details"] = {
            "vision_result": fused["vision_result"],
            "imu_result": fused["imu_result"],
        }
    return response
