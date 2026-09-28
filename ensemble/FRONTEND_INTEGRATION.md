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
| `emg`: one continuous array | **Not sent at all.** `EMG_ENABLED = false` in the firmware — no EMG hardware is wired up yet. No `"emg"` messages exist right now. |
| `vib_on`: one continuous array, sensed on-device | **Never sent by the hub in either direction that matters.** Vibration is *commanded* app→hub (`{"type":"haptic",...}`), the hub never reports back whether the motor is on. There's no sensed vibration state to read. |

Concretely: `flex` maps to `hub.pods[2].pitchDeg`, `drift` maps to
`hub.pods[3].pitchDeg` (pod IDs per `CURL_FLEX_POD_ID`/`CURL_DRIFT_POD_ID` in
`bicepCurlCounter.ts`) — those two are real and available. `emg` and
`vib_on` are not available from this hardware today, full stop.

**What this means practically**: you cannot feed the real device's live
stream into the `ml_imu` model (or the fusion API's `imu` field) and get a
meaningful answer. Options, none of them free:

1. **Send placeholder values for `emg`/`vib_on`** (e.g. `emg: 0` for every
   sample, `vib_on` from the app's own known haptic-pulse state — see
   `pulseActive` in `LiveSession.tsx`, which the app already tracks locally
   since it's the one commanding the motor). This is honest about being an
   approximation, not a fix — the model will very likely see this as
   out-of-distribution and its own novelty gate should reject it
   (`"unrecognized_input"`). That's the gate working correctly, not a bug to
   route around.
2. **Wire up the EMG hardware and set `EMG_ENABLED = true`** in the
   firmware — this gets a real `emg` signal, but `vib_on` still has no real
   sensed source; same caveat as above for that one field.
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

```bash
pip install -r ensemble/api/requirements.txt
uvicorn ensemble.api.server:app --reload --port 8000
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

Unchanged from the model side — one endpoint, one fused answer:

```ts
interface PredictRequest {
  vision: {
    frames: number[][][]     // [T][33][3] MediaPipe Pose WORLD landmarks, one rep
    duration_seconds: number // browser-measured real elapsed time, NOT derived from frame count
  }
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

## 5. Wiring in the vision side (the clean path)

1. Re-enable MediaPipe in the live flow — flip `ENABLE_MEDIAPIPE_VISION` to
   `true` in `LiveSession.tsx` (or make it a real prop/setting rather than a
   hardcoded testing flag).
2. Buffer **world** landmarks (not the `landmarks` field `CameraViewport.tsx`
   currently reads for its own on-screen angle math — both are on the same
   `PoseLandmarkerResult`, just read `.worldLandmarks[0]` instead of
   `.landmarks[0]`) for the duration of a rep:

```ts
const framesRef = useRef<number[][][]>([])
const startTimeRef = useRef<number>(0)

function onFrame(video: HTMLVideoElement, timestampMs: number) {
  const result = detectForVideo(video, timestampMs)
  if (result?.worldLandmarks?.[0]) {
    framesRef.current.push(result.worldLandmarks[0].map((lm) => [lm.x, lm.y, lm.z]))
  }
}
```

3. Pick a rep boundary to start/stop buffering. The natural hook is the same
   one `LiveSession.tsx` already uses for `repSamples` —
   `hub.curl.repCount` incrementing marks a completed rep (see the
   `prevRepCount` effect in `LiveSession.tsx`). Start the buffer when
   `repState` leaves `'down'`, stop and send when `repCount` increments.

---

## 6. Wiring in the IMU side (the honest-approximation path)

Given Section 2's gap, this is the realistic version, not a drop-in:

1. `flex`/`drift` arrays: buffer `hub.pods[2].pitchDeg` and
   `hub.pods[3].pitchDeg` over the same rep window as the vision frames.
   **Don't read these from `hub.pods` in a React effect** — `HubProvider`
   already has a documented reason its own rep counter avoids that pattern
   (`bicepCurlCounter.ts`'s class-doc: batched React state updates can
   silently drop samples that land in the same tick). Buffer inside
   `HubProvider`'s existing `onImu` handler instead, the same way
   `curlCounterRef.current.updateFlex/updateDrift` is already called there —
   e.g. a small sibling recorder class alongside `BicepCurlCounter`,
   started/stopped the same way, exposed through `HubValue` the same way
   `curl` already is.
2. `emg`: no real source today (Section 2, option 1) — send `0` for every
   sample unless you've done option 2 (wire up the hardware, flip
   `EMG_ENABLED`).
3. `vib_on`: no sensed source at all — the closest honest proxy is the app's
   own `pulseActive` boolean from `LiveSession.tsx` (it already knows when
   *it* commanded the haptic pulse), sampled at each flex/drift timestep.
   This reflects app-commanded state, not the original training signal's
   on-device sensed state — say so if this ships, don't present it as
   equivalent.
4. Expect `"unrecognized_input"` (the IMU novelty gate rejecting) to show up
   often with placeholder `emg`, and route that in the UI as "no wearable
   reading available for this rep," not as an error.

---

## 7. What's tested vs. not

**Tested (model/API side):** the API server against real HTTP requests, CORS
preflight, all four validation error cases, the fusion logic against real
per-model outputs. See `ensemble/README.md`.

**Not tested — and now known to need real work, not just wiring:**
- No browser has called this API yet.
- The vision integration path (Section 5) is straightforward but unbuilt.
- The IMU integration path (Section 6) is a genuine open question, not a
  solved problem — the placeholder-value approach will produce results, but
  "produces a response" and "produces a meaningful one" are different
  claims. Don't let a 200 response be read as validation.

---

## 8. Don't forget

Same caveats as everywhere else in this project, now more relevant than
ever given Section 2: vision's ~88.5% CV macro-F1 is the only validated
number in this system. The IMU model's 100% is a ceiling effect, not real
accuracy, on top of now being fed data from hardware it was never trained
on. The fusion layer has no accuracy number at all. None of this gets more
accurate by being wired into a frontend — only easier to reach.
