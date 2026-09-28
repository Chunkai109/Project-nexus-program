# Fusion Model Summary

A plain-language reference for what the vision + IMU fusion system is,
what its accuracy actually is, and how it would connect to a web app --
written after the live dual-sensor demo (`ensemble/scripts/
live_ensemble_demo.py`) was built. For full technical depth on any
individual piece, see `ml/README.md`, `ml_imu/README.md`, and
`ensemble/README.md` -- this document summarizes and links, it doesn't
replace them.

---

## 1. What the fusion model has

Three independent pieces, each in its own directory, combined only at the
very last step:

| Piece | Directory | Input | Output |
|---|---|---|---|
| **Vision model** | `ml/` | MediaPipe Pose landmarks from a camera | One of 6 classes: Perfect / Drag / Swing / Half / Heave / Incomplete |
| **IMU model** | `ml_imu/` | Flex/Drift/EMG/Vib from a wearable arm device | One of 4 classes: Perfect / Drag / Half / Heave |
| **Fusion layer** | `ensemble/` | Both models' own output dicts | One combined answer |

**Vision model** (`ml/src/inference/predictor.py`, `BicepCurlPredictor`):
a RandomForest trained on 41 engineered features (joint angles, torso
lean, elbow drift, tempo) from 34 real training recordings. Two safety
gates run before classification -- a "rest gate" (rejects near-zero
motion) and a novelty detector (rejects motion that doesn't resemble any
curl at all). Live sessions search sub-windows of whatever was recorded
for the best-looking rep, so total recording duration doesn't matter.

**IMU model** (`ml_imu/src/predictor.py`, `ImuCurlPredictor`): a
RandomForest trained on 19 engineered features (flex/drift/emg stats,
tempo) from 52 labeled reps derived from 35 raw sessions performed by one
person. Also has a novelty gate, though a much coarser one (see accuracy
section below). No "Swing" or "Incomplete" data exists for this model --
it only ever predicts among 4 classes.

**Fusion layer** (`ensemble/src/fusion.py`, `fuse_predictions()`): takes
both models' results and combines them --
- If either model's gate rejects the input, the fused result rejects too.
- If vision's own top class is Swing or Incomplete (classes IMU has no
  data for), vision's answer is used directly, unmodified.
- Otherwise, both models' probabilities are blended over the 4 shared
  classes, weighted **80% vision / 20% IMU**.

**Live demo** (`ensemble/scripts/live_ensemble_demo.py`): runs all three
on an actual bicep curl in real time -- camera + wearable device
simultaneously, connected over WiFi via WebSocket -- and prints vision
alone, IMU alone, and the fused result side by side. Can optionally save
each rep's raw dual-sensor data (`--save-session`) toward building the
first real synchronized validation dataset.

---

## 2. What its accuracy actually is

Stated as plainly as possible, because this is the part most likely to be
misquoted if simplified:

| Component | Number | What it actually means |
|---|---|---|
| Vision model | **~88.5% CV macro-F1** | Honestly validated via 5-fold GroupKFold cross-validation across 34 independent recordings. This is the one real, trustworthy number in the whole system. |
| IMU model | **100% CV macro-F1** | **Not a real accuracy claim.** Diagnosed as a ceiling effect: the 4 classes are trivially separable by 1-2 feature thresholds, confirmed by testing a second, unrelated model type (Logistic Regression), which also hit 100%. Reflects one person performing exaggerated, staged demonstrations, not real-world performance. |
| Fusion layer | **No number exists** | Not "unknown" in the sense of "not yet measured carefully" -- there is currently no synchronized data (same rep, both sensors, ground truth) to measure it against at all. Any number here would be invented. |

**If someone asks "what's the accuracy of the app," the only honest
answer today is 88.5%, from the vision model alone**, with the caveat that
it's cross-validated on a small (34-recording) dataset. The IMU and fusion
numbers cannot be quoted as accuracy claims without misleading whoever
you tell.

**What would change this**: real synchronized recordings (camera + IMU on
the same reps, multiple people, natural — not staged — form) would let
the IMU model's real accuracy be measured for the first time, and would
let the fusion layer's actual benefit (if any) finally be checked against
vision alone, per `ensemble/README.md`'s validation plan.

---

## 3. How to connect it with a web app

### The existing `frontend/` is not a ready-made target -- and that's worth knowing before assuming otherwise

`frontend/` is a real, fairly complete React app, but it was built for a
**different product concept**: a physical-therapy platform tracking
**knee flexion during squats** (not bicep curls), using a **6-pod
Bluetooth (BLE) wearable IMU+EMG+haptics network** (not the single WiFi
WebSocket device this project's `ml_imu/` was built around), and its
sensor data today is **entirely simulated** (`useSensorStream.ts`'s own
comment: *"There is no ESP32/BLE link connected in this draft"*) --
generated with sine waves and jitter, not a trained model.

One piece genuinely does transfer directly, though:
`frontend/src/lib/pose/usePoseLandmarker.ts` already runs **the same
MediaPipe Pose model** (`pose_landmarker_lite.task`, video mode) that
`ml/scripts/webcam_demo.py` uses, client-side in the browser via
`@mediapipe/tasks-vision`, with a vendored WASM build and GPU/CPU
fallback already solved. `LiveSession.tsx` even already has a "prefer
live camera, fall back to wearable" pattern
(`usingVision ? vision.flexionDeg : simulated.kneeFlexionDeg`) -- the
same *spirit* as this project's fusion logic, just currently comparing a
real camera angle against fake wearable data, with simple hand-written
thresholds instead of trained classifiers.

### Recommended integration architecture

**Keep pose extraction client-side (it already works); do the
classification server-side (don't reimplement it in JavaScript).**

The vision model's feature engineering (`ml/src/features/engineer.py`)
and normalization (`ml/src/preprocessing/normalize.py`) are specific,
order-sensitive Python code, fit to a specific RandomForest. Porting that
logic to TypeScript risks subtle mismatches between what the browser
computes and what the model was trained on -- a classic train/serve skew
bug that would silently produce wrong predictions with no error message.
Reusing the exact Python code behind a thin API avoids that risk
entirely.

Concretely:

1. **Browser**: keep using `usePoseLandmarker.ts` to extract MediaPipe
   Pose world landmarks every frame (already built, already working).
   Buffer them for the duration of a rep (`s`/`e`-style start/stop, same
   as the Python demos).
2. **Browser -> backend**: on rep end, POST the buffered landmark
   sequence (a JSON array of `[x,y,z]` triples per frame per landmark) to
   a small backend endpoint. If the IMU device is also connected (WiFi
   WebSocket, `ensemble/src/imu_live_client.py`'s parsing logic), the
   frontend can either connect to it directly (same network, same
   approach as the Python live demo) or the backend can broker that
   connection -- either way, send the buffered `(flex, drift, emg,
   vib_on)` arrays alongside the landmarks.
3. **Backend** (new, doesn't exist yet -- a small FastAPI/Flask service
   is enough): wraps the *unmodified* existing Python code --
   `BicepCurlPredictor.predict_full_sequence()` or the live-session path,
   `ImuCurlPredictor.predict_from_arrays()`, and
   `fuse_predictions()`. One endpoint, one request/response cycle per
   rep. The response is exactly the dict shape `fuse_predictions()`
   already returns (`prediction`, `confidence`, `good_form_score`,
   `class_probabilities`, `source`, plus the raw `vision_result`/
   `imu_result` for a detailed view) -- no new data model to design, it
   already exists and is documented in `ensemble/README.md`.
4. **Browser**: render the response. This is where `frontend/`'s existing
   UI patterns (`RadialGauge`, `EmgActivationBar`, the fault/haptic
   feedback cards in `LiveSession.tsx`) are genuinely reusable -- just
   feeding them from the real fused result instead of
   `useSensorStream.ts`'s simulation.

### What this does *not* solve

- The IMU device here uses **WiFi WebSocket**; `frontend/`'s wearable
  code (`useBleHub`, `BleProvider`) assumes **Bluetooth**. These are
  different browser APIs (`WebSocket` vs. Web Bluetooth) and different
  device protocols -- connecting the real bicep-curl IMU device to this
  frontend means adding new WiFi WebSocket client code, not reusing the
  BLE hub.
- `frontend/`'s data model (`AngleConfig`, `PodId`, knee-flexion-specific
  fields in `SessionMetrics`) is built around the multi-pod knee/squat
  concept. Bicep-curl tracking with a 4-6 class quality label doesn't fit
  that shape -- it would need its own exercise type/page, not a field
  added to the existing one.
- None of this changes the accuracy picture in Section 2. Wiring the
  model into a web app makes it easier to *use*, not more *validated*.
