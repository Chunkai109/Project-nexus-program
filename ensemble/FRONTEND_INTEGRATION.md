# Frontend Integration Guide

How to connect a web frontend to the bicep-curl fusion model, with the API
contract as the centerpiece. Written to hand off to whoever builds the
frontend side -- everything here is already built and tested on the
model/API side; nothing here has been tested against an actual browser
yet (see the "What's tested vs. not" note at the end).

For the full picture (what the model has, its accuracy, why the design
decisions were made) see `ensemble/README.md` and
`ensemble/FUSION_MODEL_SUMMARY.md`. This file is narrower and more
copy-pasteable on purpose.

---

## 1. Run the API

```bash
cd Project-nexus-program
pip install -r ensemble/api/requirements.txt
uvicorn ensemble.api.server:app --reload --port 8000
```

That's the whole setup -- it loads the already-trained model files
committed in `ml/models/best_model/` and `ml_imu/models/best_model/`, no
camera or IMU device needed to just run the server. Confirm it's up:

```bash
curl http://localhost:8000/health
# {"status":"ok"}
```

CORS is wide open (`allow_origins=["*"]`) for local development. **Before
deploying anywhere real, restrict this to the actual frontend's origin**
in `ensemble/api/server.py`'s `CORSMiddleware` config.

---

## 2. The API contract

One endpoint. `POST /predict`.

### Request

```ts
interface PredictRequest {
  vision: {
    frames: number[][][]     // [T][33][3] -- T frames, 33 landmarks, [x,y,z] each
    duration_seconds: number // real elapsed time between start and stop, in seconds
  }
  imu: {
    flex: number[]
    drift: number[]
    emg: number[]
    vib_on: boolean[]        // same length as flex/drift/emg
  }
}
```

**`vision.frames`**: the MediaPipe Pose **world landmarks** for one rep,
one frame at a time, 33 landmarks per frame, `[x, y, z]` per landmark.
This is exactly what `frontend/src/lib/pose/usePoseLandmarker.ts`'s
`detectForVideo()` already returns via `PoseLandmarkerResult.worldLandmarks[0]`
-- same model file (`pose_landmarker_lite.task`), same landmark order, both
the frontend and the Python model use the same underlying MediaPipe
implementation. Buffer these into an array for the duration of a rep
(start/stop, same idea as a record button).

**`vision.duration_seconds`**: measure this yourself in the browser
(`performance.now()` at start and stop, subtract, divide by 1000) --
**do not** derive it from the frame count, and don't leave it for the
server to guess. The vision model searches the capture for the
best-looking sub-window, and that search needs to know how long the rep
actually took in real time; the server can't know that on its own once
frames arrive over the network; wrong duration doesn't crash anything but
degrades a real signal.

**`imu.*`**: four parallel arrays, one value per sample, all the same
length -- the same `flex`/`drift`/`emg`/`vib_on` values the IMU device
sends over its WiFi WebSocket (JSON, confirmed with the device's
developer). Buffer these the same way, over the same start/stop window as
the vision frames.

### Response (200 OK)

```ts
interface PredictResponse {
  exercise: "bicep_curl"
  prediction: "Perfect" | "Drag" | "Swing" | "Half" | "Heave" | "Incomplete"
            | "no_exercise_detected" | "unrecognized_movement" | "unrecognized_input" | null
  confidence: number | null       // 0-1, null when rejected/insufficient data
  good_form_score: number | null  // 0-1, the number to show as a headline "% good form"
  good_form_score_raw?: number
  class_probabilities?: Record<string, number>
  source: "fused" | "vision_only_exclusive_class"
        | "rejected_by_vision_gate" | "rejected_by_imu_gate" | "insufficient_data"
  message: string   // always present -- human-readable explanation of what happened and why
}
```

**This is always ONE prediction** -- never two separate vision/IMU
answers to reconcile. `source` tells you *how* the answer was produced
(useful for a debug view or a small "how was this determined" tooltip),
but `prediction`/`good_form_score` is the one thing to render by default.

Add `?debug=true` to the request URL and the response gains a `"details"`
field with the raw `vision_result`/`imu_result` the fusion was computed
from -- useful for a developer console or troubleshooting view, not
something to show a normal user.

### Errors (400 Bad Request)

```json
{ "detail": "vision.frames must have shape (T, 33, 3); got (1, 1, 2). Each frame needs all 33 MediaPipe Pose world landmarks." }
```

Four validated cases, each with a specific message (not a generic 400):
wrong landmark shape, fewer than 10 vision frames, empty IMU arrays,
mismatched IMU array lengths. Anything else is a `500` (shouldn't happen
with well-formed input matching the contract above; if it does, that's a
bug worth reporting with the request payload that triggered it).

---

## 3. Minimal example (TypeScript / fetch)

```ts
async function predictRep(
  frames: number[][][],
  durationSeconds: number,
  imu: { flex: number[]; drift: number[]; emg: number[]; vib_on: boolean[] },
): Promise<PredictResponse> {
  const res = await fetch("http://localhost:8000/predict", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      vision: { frames, duration_seconds: durationSeconds },
      imu,
    }),
  })
  if (!res.ok) {
    const { detail } = await res.json()
    throw new Error(`predict failed (${res.status}): ${detail}`)
  }
  return res.json()
}
```

Buffering vision frames, paired with `usePoseLandmarker.ts`:

```ts
const framesRef = useRef<number[][][]>([])
const startTimeRef = useRef<number>(0)

function startRecording() {
  framesRef.current = []
  startTimeRef.current = performance.now()
}

// call this every video frame while recording, e.g. inside CameraViewport's loop
function onFrame(videoEl: HTMLVideoElement, timestampMs: number) {
  const result = detectForVideo(videoEl, timestampMs)
  if (result?.worldLandmarks?.[0]) {
    framesRef.current.push(result.worldLandmarks[0].map((lm) => [lm.x, lm.y, lm.z]))
  }
}

async function stopRecordingAndPredict(imu: ImuBuffer) {
  const durationSeconds = (performance.now() - startTimeRef.current) / 1000
  return predictRep(framesRef.current, durationSeconds, imu)
}
```

---

## 4. Connecting to the IMU device from the browser

The device streams JSON over a WiFi WebSocket. In the browser:

```ts
const flexBuf: number[] = []
const driftBuf: number[] = []
const emgBuf: number[] = []
const vibBuf: boolean[] = []
let recording = false

const ws = new WebSocket("ws://<device-ip>:<port>/")
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data)
  // Exact key names weren't confirmed at time of writing -- log the raw
  // message once on first connect to confirm, same as
  // ensemble/src/imu_live_client.py's Python client does. Adjust the
  // field names below to match once confirmed.
  if (!recording) return
  flexBuf.push(msg.flex)
  driftBuf.push(msg.drift)
  emgBuf.push(msg.emg)
  vibBuf.push(Boolean(msg.vib_on ?? msg.vib === "ON"))
}
```

Start/stop this buffering on the same start/stop actions as the vision
buffer above, then pass `{ flex: flexBuf, drift: driftBuf, emg: emgBuf,
vib_on: vibBuf }` as the `imu` argument to `predictRep()`.

---

## 5. What's tested vs. not

**Tested, confirmed working:**
- The API server, run live and hit with a real HTTP request over an
  actual network socket (not just Python-internal testing) -- real data
  in, correct single fused prediction out.
- CORS preflight (`OPTIONS` request) answers correctly for a
  cross-origin request, same as a browser would send before its real
  `POST`.
- All four input-validation error cases return clean `400`s.

**Not tested -- flagging honestly rather than implying otherwise:**
- No actual browser has called this API yet. The `fetch()` example above
  is standard and should work as-is, but hasn't been run.
- The IMU WebSocket JSON key names in the browser example above are
  placeholders (`flex`, `drift`, `emg`, `vib_on`/`vib`) -- confirm the
  exact key names the real device sends before relying on them (same
  caveat that applies to `ensemble/src/imu_live_client.py`'s Python
  client).
- MediaPipe's browser (`@mediapipe/tasks-vision`) and Python
  (`mediapipe`) packages using the same model file is a strong reason to
  expect identical landmark output, but this hasn't been directly
  diffed frame-for-frame between the two runtimes.

## 6. Don't forget

Whatever UI ends up showing `good_form_score` or `prediction` to a real
user, the accuracy caveats from `ensemble/FUSION_MODEL_SUMMARY.md` still
apply no matter how the API is wired in: vision's ~88.5% CV macro-F1 is
the only validated number in this system. The IMU model's 100% is a
ceiling effect, not real accuracy, and the fusion layer has no accuracy
number at all yet. Wiring this into a frontend makes it easier to use,
not more accurate.
