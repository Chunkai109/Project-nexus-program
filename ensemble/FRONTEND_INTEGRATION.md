# Frontend Integration Guide (v2 — updated for the actual `main` frontend)

**This replaces the previous version of this file.** That version was written
against an older read of `frontend/`. Since then, `main` picked up 30+
independent commits that replaced the frontend's wearable layer entirely (a
new ESP32 "SmartPhysio Hub" over WiFi WebSocket, dropping the earlier
Bluetooth design) and added bicep-curl-specific logic of its own. This
version is written against that real, current code — including one important
finding the old version didn't know about: **the real hardware's data format
doesn't match what the IMU model expects**, in a way that has no easy fix.
Read Section 2 before wiring anything up.

---

## 1. Get the code

```bash
git clone https://github.com/Chunkai109/Project-nexus-program.git
cd Project-nexus-program
```

No branch checkout needed — the model code (`ml/`, `ml_imu/`, `ensemble/`)
was merged into `main` and is there now, alongside the frontend.

```
ensemble/
  api/            (server.py, requirements.txt)  <- the API itself
  src/            (fusion.py)                    <- combines the two models

ml/            <- vision (MediaPipe Pose) model, RandomForest, ~88.5% CV macro-F1
ml_imu/        <- IMU/EMG wearable model, RandomForest, trained on a DIFFERENT device (see Section 2)
```

Same as before: this is code + trained artifacts together, already
committed, no training step needed to run it.

---

## 2. Read this first — the live app doesn't call either model today

This is the important part. Before writing any integration code, understand
what `frontend/` actually does right now, on `main`:

### The bicep-curl Live Session doesn't use the trained models at all

`frontend/src/pages/LiveSession.tsx` counts reps and detects bad form using
its own hand-written threshold state machine —
`frontend/src/lib/hub/bicepCurlCounter.ts`'s `BicepCurlCounter` class. It
watches two raw angle values (`flex`, `drift`) cross fixed numeric
thresholds (`START_CURL_LIMIT`, `CONTRACTION_LIMIT`, `DRIFT_TOLERANCE`, …).
This is **not** the `ml_imu` RandomForest — it's separate, simpler,
hand-tuned logic that predates (and doesn't know about) this project's model.

MediaPipe Pose (`CameraViewport.tsx` / `usePoseLandmarker.ts`) is still
wired into the page, but it's currently **disabled** for this flow:

```ts
// LiveSession.tsx
const ENABLE_MEDIAPIPE_VISION = false  // testing flag — MPU-only
```

Even when enabled, it only feeds `frontend/src/lib/pose/poseMetrics.ts`'s
own hand-computed knee-angle/valgus math for the on-screen gauge — again,
not the trained `ml/` classifier. Nowhere in `frontend/src` is there a call
to `/predict` or anything resembling it (checked directly — no matches).

**So "connecting the model to the frontend" is new work, not a wiring
change to something half-built.** Both integration paths below have to be
added from scratch. That's expected and fine — this section just makes sure
whoever does it isn't debugging against an assumption that some of this
already exists.

### The real hardware doesn't produce the IMU model's input format

This is the harder problem, and there's no clean fix — just an honest
tradeoff to make.

`ml_imu`'s RandomForest was trained on four time-aligned arrays — `flex`,
`drift`, `emg`, `vib_on` — from a **different physical device** (the
`Test_MPU.zip` logs). The real ESP32 hub now in this repo
(`firmware/smartphysio_hub/smartphysio_hub.ino`,
`frontend/src/lib/hub/protocol.ts`) sends something structurally different:

| Model expects | Real hub actually sends |
|---|---|
| `flex`: one continuous array, one sample per timestep | `{type:"imu", podId:2, pitch:<flexion>}` — a separate WebSocket message per sample, one pod |
| `drift`: same, aligned to the same timestep as `flex` | `{type:"imu", podId:3, pitch:<drift>}` — separate message, separate pod |
| `emg`: one continuous array | `{type:"emg", podId:1, vrms:<0.0-1.0>}` — a separate WebSocket message per sample, one pod. `vrms` is a noise-filtered envelope: raw ADC readings over `EMG_NOISE_THRESHOLD` (1000, out of the ESP32's 12-bit 0-4095 range) are rejected as motion/contact artifacts rather than counted, then normalized against that threshold. |
| `vib_on`: one continuous array, sensed on-device | **Never sent by the hub in either direction that matters.** Vibration is *commanded* app→hub (`{"type":"haptic",...}`), the hub never reports back whether the motor is on. There's no sensed vibration state to read. |

Concretely: `flex` maps to `hub.pods[2].pitchDeg`, `drift` maps to
`hub.pods[3].pitchDeg` (pod IDs per `CURL_FLEX_POD_ID`/`CURL_DRIFT_POD_ID` in
`bicepCurlCounter.ts`), and `emg` maps to `hub.pods[1].vrmsNormalized` — those
three are real and available. `vib_on` is not available from this hardware
today, full stop.

**What this means practically**: you cannot feed the real device's live
stream into the `ml_imu` model (or the fusion API's `imu` field) and get a
meaningful answer, since `vib_on` still has no real sensed source even with
`emg` now real. Options, none of them free:

1. **Send a placeholder value for `vib_on`** — the app's own known
   haptic-pulse state (see `pulseActive` in `LiveSession.tsx`, which the app
   already tracks locally since it's the one commanding the motor) is the
   closest honest proxy. This is honest about being an approximation, not a
   fix — the model will very likely see this as out-of-distribution and its
   own novelty gate should reject it (`"unrecognized_input"`). That's the
   gate working correctly, not a bug to route around.
2. **Add a sensed vibration-state readback to the firmware** (e.g. an
   always-on flag the ESP32 reports back over WebSocket while the motor is
   driven) so `vib_on` stops being a client-side guess — no such readback
   exists today.
3. **Don't wire the IMU model into this specific hub at all**, and treat
   `ml_imu` as validated-but-not-yet-deployable until either the hardware or
   the model is revisited. Given `ml_imu`'s own accuracy caveats (100% CV is
   a diagnosed ceiling effect, not real accuracy — see
   `ensemble/FUSION_MODEL_SUMMARY.md`), this is a defensible call, not a
   cop-out.

This document doesn't make that call for you — it's a real product decision
your team should make with eyes open, not something to silently paper over
with fabricated `emg`/`vib_on` values that look plausible but aren't real
sensor data (this project has a standing rule against exactly that kind of
fabrication — see `ensemble/README.md`).

**The vision model doesn't have this problem.** `usePoseLandmarker.ts`
already extracts the exact same MediaPipe Pose landmarks (image-space *and*
world-space, both on the same result object) the Python model expects — that
integration path is clean. See Section 4.

---

## 3. Set up and run the API

One-time setup:

```bash
pip install -r ensemble/api/requirements.txt
```

Then, from `frontend/`, `npm run dev` starts **both** Vite and this API
together (via `concurrently` — see `package.json`'s `dev`/`dev:web`/`dev:api`
scripts), each with its own colored `[vite]`/`[api]` prefix in one terminal.
If the API fails to start (Python not installed, deps missing, wrong
`python`/`python3` on your platform — the script assumes `python`, edit
`dev:api` in `package.json` if yours is `python3`), Vite keeps running
regardless; the frontend is built to degrade to a "Model Offline" state
rather than depend on this API being up.

To run just the API on its own (e.g. to see its logs without Vite's, or to
`curl` it directly):

```bash
cd ..   # repo root, not frontend/ -- `ensemble` must be importable from cwd
python -m uvicorn ensemble.api.server:app --reload --port 8000
```

```bash
curl http://localhost:8000/health
# {"status":"ok"}
```

CORS is wide open (`allow_origins=["*"]`) for local dev — restrict it to the
real frontend origin in `ensemble/api/server.py` before deploying anywhere
real.

---

## 4. The API contract

Two endpoints now, not one — see Section 5 for why a vision-only one was
added rather than routing the frontend's camera-only integration through the
fused endpoint with fabricated IMU arrays.

### `POST /predict/vision` — vision only, no IMU data needed

This is what `frontend/src/lib/visionModel.ts` actually calls.

```ts
interface VisionInput {
  frames: number[][][]     // [T][33][3] MediaPipe Pose WORLD landmarks, one rep
  duration_seconds: number // browser-measured real elapsed time, NOT derived from frame count
}

interface VisionPredictResponse {
  exercise: "bicep_curl"
  prediction: "Perfect" | "Drag" | "Swing" | "Half" | "Heave" | "Incomplete"
            | "no_exercise_detected" | "unrecognized_movement" | null
  confidence: number | null
  good_form_score?: number   // 0-1, the headline number — absent on a gate rejection or null prediction
  good_form_score_raw?: number
  class_probabilities?: Record<string, number>
  message?: string
  num_frames?: number
}
```

`400` errors, each with a specific message: wrong `frames` shape, fewer than
10 vision frames.

### `POST /predict` — fused vision + IMU, one answer

Unchanged from the model side:

```ts
interface PredictRequest {
  vision: VisionInput
  imu: {
    flex: number[]
    drift: number[]
    emg: number[]
    vib_on: boolean[]        // same length as flex/drift/emg
  }
}

interface PredictResponse {
  exercise: "bicep_curl"
  prediction: "Perfect" | "Drag" | "Swing" | "Half" | "Heave" | "Incomplete"
            | "no_exercise_detected" | "unrecognized_movement" | "unrecognized_input" | null
  confidence: number | null
  good_form_score: number | null   // 0-1, the headline number
  good_form_score_raw?: number
  class_probabilities?: Record<string, number>
  source: "fused" | "vision_only_exclusive_class"
        | "rejected_by_vision_gate" | "rejected_by_imu_gate" | "insufficient_data"
  message: string
}
```

**Always one prediction** — never separate vision/IMU answers to reconcile.
Add `?debug=true` to get the raw per-model results back too, under
`"details"`.

`400` errors, each with a specific message: wrong `frames` shape, fewer than
10 vision frames, empty IMU arrays, mismatched IMU array lengths.

---

## 5. Wiring in the vision side (the clean path) — DONE

This is now built, not a plan. What actually shipped, for anyone extending it:

1. `ENABLE_MEDIAPIPE_VISION` is `true` by default in `LiveSession.tsx` — the
   camera pipeline runs unconditionally now rather than needing a manual flip.
2. `CameraViewport.tsx` gained an `onWorldLandmarks` prop, fired every
   detected frame (unthrottled, unlike the existing `onVisionMetrics`) with
   `.worldLandmarks[0]` mapped to plain `[x, y, z]` arrays — the exact input
   shape the trained classifier expects, with no reordering needed (MediaPipe's
   standard 33-landmark order is the same on both the JS Tasks Vision API and
   Python `mediapipe.solutions.pose` sides).
3. `LiveSession.tsx` buffers those frames into a ref for as long as a person
   is in view, and flushes + classifies the buffer at the same `repCount`
   -incrementing boundary `repSamples` already uses (not gated on
   `hub.curl.repState` specifically, since vision mode works standalone with
   no hub/wearable connected at all — a real, common case this project
   supports elsewhere).
4. The buffered frames + measured `duration_seconds` are POSTed to the
   vision-only endpoint (see Section 4) via
   `frontend/src/lib/visionModel.ts`'s `predictVisionForm()` — used whenever
   no hub is connected, so there's no real IMU data to send at all. When a
   hub *is* connected, `predictFusedForm()` is used instead — see Section 6,
   now also built.
5. The result renders in an "AI Form Check" card in `LiveSession.tsx`
   (idle / checking / result / unavailable states) — `unavailable` is the
   normal state whenever the API process (Section 3) isn't running; the UI
   degrades to that silently rather than erroring.

---

## 6. Wiring in the IMU side — DONE, deliberately partial

This is now built too, but not as a full "approximate all four fields"
attempt — a product call was made to keep only `flex`/`drift` real and treat
`emg`/`vib_on` as fixed, inert placeholders rather than trying to approximate
them from other signals. What actually shipped:

1. `flex`/`drift`: real, from `hub.pods[2].pitchDeg`/`hub.pods[3].pitchDeg`.
   Per this section's original warning, these are **not** read from
   `hub.pods` in a React effect — `frontend/src/lib/hub/imuFlexDriftRecorder.ts`'s
   `ImuFlexDriftRecorder` buffers them synchronously inside `HubProvider`'s
   `onImu` handler, the same way `BicepCurlCounter` already does, and exposes
   the buffer via `hub.drainFlexDriftSamples()` — called once per completed
   rep from `LiveSession.tsx`, mirroring exactly how vision frames are
   buffered and drained.
2. `emg`: **not** wired into this call, despite now being a real, available
   signal (`hub.pods[1].vrmsNormalized`) — sent as `0` for every sample
   instead. This was an explicit choice: only flex/drift should influence
   this particular prediction; EMG continues to feed Session Analytics /
   patient-report metrics exactly as it already did before this model
   existed (`repSamples` in `LiveSession.tsx`), untouched by this change.
3. `vib_on`: sent as `false` for every sample — no attempt at an
   app-commanded-state proxy (`pulseActive`) was made here, again by
   explicit choice, to keep every non-flex/drift field a plain, inert
   placeholder rather than a signal that could be mistaken for real.
4. Practical result: expect `"unrecognized_input"` (the IMU novelty gate
   rejecting) to show up often, since `emg`/`vib_on` are always degenerate
   constants and even real flex/drift comes from different hardware than
   the model was trained on. Surfaced in the UI as the `source` field on
   the result (`"rejected_by_imu_gate"`), not as an error — see the "AI Form
   Check" card in `LiveSession.tsx`.

---

## 7. What's tested vs. not

**Tested (model/API side):** both endpoints against real HTTP requests
(`/predict/vision` and the fused `/predict`), CORS preflight, all validation
error cases, the fusion logic against real per-model outputs. See
`ensemble/README.md`.

**Tested (vision integration, Section 5):** a real Chromium browser calling
`predictVisionForm()` against a live local API instance — both the success
path (200, gate correctly rejects out-of-distribution input) and the
API-offline path (`fetch` rejects, `LiveSession.tsx`'s "AI Form Check" card
degrades to its `unavailable` state rather than throwing). **Not** tested
end-to-end with a real camera + a real bicep curl in front of it — that needs
an actual webcam and a person, not something a sandboxed test runner has.
The MediaPipe model-asset fetch (from Google's CDN, in `usePoseLandmarker.ts`)
is also unverified inside network-restricted sandboxes specifically — it
works from a normal machine with normal internet access, which is the only
environment this ships to.

**Tested (fused integration, Section 6):** a real Chromium browser calling
`predictFusedForm()` against a live local API instance — confirmed the
request body carries real flex/drift values, `emg` as all-zero and `vib_on`
as all-`false` placeholders, all four arrays the same length, and that it
throws before any network call for an empty flex/drift buffer. **Not**
tested with a real hub attached mid-curl, and — this is the important
caveat, not a testing gap — **not validated as meaningful**: the
placeholder-only `emg`/`vib_on` approach will produce responses, but
"produces a response" and "produces a meaningful one" are different claims.
Frequent `"rejected_by_imu_gate"` results are the expected outcome, not
evidence something is broken.

---

## 8. Don't forget

Same caveats as everywhere else in this project, now more relevant than
ever given Section 2: vision's ~88.5% CV macro-F1 is the only validated
number in this system. The IMU model's 100% is a ceiling effect, not real
accuracy, on top of now being fed data from hardware it was never trained
on. The fusion layer has no accuracy number at all. None of this gets more
accurate by being wired into a frontend — only easier to reach.
