# Vision + IMU ensemble (fusion layer)

## This is built and unit-tested for correctness, NOT validated for real-world benefit

**No synchronized dual-sensor recording exists.** The vision dataset
(`ml/`) and the IMU dataset (`ml_imu/`) were collected completely
separately -- different sessions, not the same reps, not even confirmed to
be the same person. Real deployment will eventually run the camera and the
wearable device simultaneously on the same rep, which is what makes a
fusion layer architecturally sound to build -- but **there is currently no
way to check whether combining the two models' outputs actually produces a
better result than the vision model alone.** Every number this module
produces should be read as "the fusion mechanism works as designed," not
"fusing improves accuracy." Treat this the same way this project has
treated every other unvalidated claim: state it up front, not as a
footnote.

## What it does

`ensemble/src/fusion.py::fuse_predictions(vision_result, imu_result)`
takes each model's own already-computed result dict --
`BicepCurlPredictor.end_session()` from `ml/` and
`ImuCurlPredictor.predict_from_arrays()` from `ml_imu/` -- and combines
them. It does not reimplement either model's session/streaming/feature
logic; both models run their own independent inference first, and this
function is a pure combination step on top.

### Three design decisions (resolved with the user, applied exactly)

1. **Label mismatch**: vision has 6 classes (Perfect/Drag/Swing/Half/
   Heave/Incomplete); the IMU model originally covered only 4 (no real
   Swing/Incomplete data existed for it, and fabricating that data was
   explicitly rejected as circular/dishonest). A second data-collection
   batch later added real Swing (5 sessions) and Incomplete (1 session)
   examples, so `SHARED_CLASSES` now covers all 6 and
   `VISION_EXCLUSIVE_CLASSES` is empty -- IMU's opinion is blended in for
   every class instead of bypassed for two of them. **This is a
   capability change, not a validated-improvement one**: Swing's data has
   an unresolved sensor-calibration-offset question, and Incomplete has
   exactly one example (too few for its GroupKFold score to mean much,
   and that one example is currently rejected by IMU's own novelty gate)
   -- see `ml_imu/README.md`'s "Second data batch" and "Trained
   classifier" sections for the full investigation. IMU's opinion on
   these two classes should be trusted less than on Perfect/Drag/Half/
   Heave; the fixed global `vision_weight` below can't express that
   difference per-class, which is a known limitation, not an oversight.

2. **Weighting**: heavily favor vision, **80/20 by default**
   (`DEFAULT_VISION_WEIGHT`). This reflects the real, current honesty gap
   between the two models: vision has an independently-validated ~88.5%
   GroupKFold CV macro-F1; IMU's headline CV macro-F1 is now 0.822 (the
   4-class version of this dataset hit a suspicious ceiling of 1.000,
   confirmed as a red flag via both RandomForest and Logistic Regression
   hitting it identically -- adding Swing/Incomplete broke that ceiling
   by exposing how little data backs the two new classes, a more honest
   number, not a regression). 80/20 is a documented policy choice, not a
   value fit to data -- there is no synchronized data to fit it to.

3. **Gate conflicts**: if **either** model's own gate rejects the input
   (vision's rest gate or `IsolationForest` novelty detector, or the IMU
   model's own novelty gate), the ensemble reports that rejection rather
   than forcing a guess from whichever model didn't reject. Conservative
   by design: if one sensor thinks this isn't a valid curl, that's a
   reason to distrust the whole reading, not to fall back on the other
   sensor alone.

### Return shape

Every call returns a dict with `"source"` set to one of:
- `"rejected_by_vision_gate"` -- vision's own gate rejected first, checked before anything else.
- `"rejected_by_imu_gate"` -- IMU's novelty gate rejected (checked second).
- `"vision_only_exclusive_class"` -- vision's top class is in `VISION_EXCLUSIVE_CLASSES`, currently empty (IMU now has real, if thin, data for all 6 classes -- see design decision 1 above), so this branch is unreachable today but kept in the code as the mechanism to revert a class to vision-only if its IMU data turns out not to generalize.
- `"fused"` -- both models had a real say; `class_probabilities` is the weighted blend over `SHARED_CLASSES` (all 6 classes today; renormalized after dropping any `VISION_EXCLUSIVE_CLASSES` mass, currently none -- the exact amount dropped, if any, is stated in the returned `"message"`), and a `good_form_score` is derived by running the blended P(Perfect) through vision's existing calibration anchor (an approximation, since that anchor was tuned for vision's raw output alone, not a blend).

Every branch includes the raw `vision_result` and `imu_result` unmodified,
so nothing is hidden behind the fused number.

## How to run it

```bash
python -m ensemble.scripts.demo_fusion                                    # logic tests only
python -m ensemble.scripts.demo_fusion --csv /path/to/bicep_with_incomplete.csv  # + real-data smoke test
python -m ensemble.scripts.verify_live_client_parsing                     # IMU WebSocket message-format parser checks
```

`demo_fusion.py` has two parts:
1. **Logic/correctness tests** on hand-constructed mock result dicts --
   verifies gate-rejection precedence, the exclusive-class bypass, and the
   weighted-blend math against hand-computed expected values. These test
   the *code*, not real-world accuracy.
2. **Plumbing smoke test** pairing one real vision TEST-split result with
   one real IMU result, to confirm the actual dict shapes from both models
   flow through `fuse_predictions()` without errors. This pairing is
   **arbitrary** -- the vision rep and the IMU rep are from completely
   unrelated real-world events -- and proves only that the code runs
   cleanly against real outputs, not that the fused answer means anything.

## Web API (`ensemble/api/`)

A small FastAPI service exposing both the fusion model and the vision model
alone to a web frontend. `POST /predict` is **one fused prediction
endpoint** -- by design, the caller never sees "vision's answer" and "IMU's
answer" as two separate things to reconcile. The individual per-model
results are still computed internally (the fusion function needs them) and
are only included in the response, under a `"details"` key, if you
explicitly ask for them (`?debug=true`) -- never as the primary response
shape. `POST /predict/vision` runs the vision model alone, for a
camera-only integration with no wearable connected (this project's frontend
uses this one, not the fused endpoint -- see
`ensemble/FRONTEND_INTEGRATION.md` Section 5 for why: fusing would mean
inventing IMU arrays for a session with no real wearable data).

```bash
pip install -r ensemble/api/requirements.txt
uvicorn ensemble.api.server:app --reload --port 8000
```

(Or, once dependencies are installed, run `npm run dev` from `frontend/` —
it starts this API alongside the Vite dev server in one terminal. See
`ensemble/FRONTEND_INTEGRATION.md` Section 3.)

`POST /predict`:

```json
{
  "vision": {
    "frames": [[[x, y, z], ... 33 landmarks ...], ... T frames ...],
    "duration_seconds": 3.2
  },
  "imu": {
    "flex": [2.7, 2.7, ...],
    "drift": [-1.6, -1.7, ...],
    "emg": [1967, 2469, ...],
    "vib_on": [false, false, ...]
  }
}
```

- `vision.frames`: the MediaPipe Pose world landmarks the browser already
  extracts (`usePoseLandmarker.ts` in `frontend/`), buffered for one rep.
- `vision.duration_seconds`: the browser's own measured elapsed time
  between starting and stopping the recording -- **not** derived from the
  frame count. This matters: the vision model searches sub-windows of the
  capture for the best-looking rep (see `ml/README.md`'s "Duration-
  independent live inference" section), and that search needs to know the
  real recording duration. Measuring it server-side instead (e.g. from
  when the request arrived) would be wrong -- it would reflect network
  timing, not how long the rep actually took. Passing the browser's own
  measurement through to
  `BicepCurlPredictor.end_session(duration_seconds_override=...)` (added
  specifically for this) keeps that calculation correct.
- `imu.*`: the same 4 arrays the IMU device streams over its WiFi
  WebSocket (JSON, confirmed) -- `flex`/`drift`/`emg`/`vib_on`, one value
  per sample, all the same length.

Response (default): the single fused result --
`prediction`/`confidence`/`good_form_score`/`class_probabilities`/
`source`/`message` -- exactly the shape `fuse_predictions()` already
returns, minus the raw `vision_result`/`imu_result`. Add `?debug=true` to
get those back too, under `"details"`, for inspecting *why* the fused
answer came out the way it did without changing what a normal frontend
request receives.

Malformed input (wrong landmark shape, too few frames, empty or
mismatched-length IMU arrays) gets a `400` with a specific message
instead of a stack trace -- verified in
`ensemble/scripts/verify_api.py`, which also confirms the response never
leaks `vision_result`/`imu_result` unless `debug=true` was requested.

```bash
python -m ensemble.scripts.verify_api                                     # validation checks only
python -m ensemble.scripts.verify_api --csv /path/to/bicep_with_incomplete.csv  # + a real end-to-end request
```

**Same accuracy caveat as everywhere else in this document applies to
every response this API returns** -- wrapping the model in an API makes
it easier to call, not more validated.

## Live demo + how to actually collect that synchronized data

`ensemble/scripts/live_ensemble_demo.py` runs the vision model, the IMU
model, and this fusion layer together on a real, live bicep curl --
webcam + wearable device simultaneously (the IMU device connects over
WiFi via WebSocket; see `ensemble/src/imu_live_client.py`, which tries
JSON then falls back to the same plain-text log format the offline
`ml_imu/data/imu_raw/Test N.txt` files use, since the device's exact
message format wasn't confirmed when this was built). Like
`ml/scripts/webcam_demo.py`, this runs on **your own machine**, not a
cloud session -- it needs a real camera and real access to the IMU
device's WiFi network.

```bash
python -m ensemble.scripts.live_ensemble_demo \
    --model pose_landmarker_lite.task --ws-url ws://<device-ip>:<port>/ \
    --save-session ensemble/data/synchronized_sessions/
```

Pass `--save-session <dir>` and every rep you run through this script
saves its raw vision keypoints + raw IMU arrays to disk, **unlabeled** --
consistent with this project's standing refusal to auto-generate labels;
label each saved session yourself afterward based on what was actually
performed, the same discipline already applied to `ml_imu/`'s original 35
sessions. This is the concrete mechanism for finally building the
synchronized dataset the validation plan below depends on.

## Future validation plan (not done yet)

Once synchronized recordings exist (camera + wearable device running
simultaneously on the same real reps, with ground-truth labels --
`live_ensemble_demo.py --save-session` above is how to collect them):
1. Run both models on each synchronized rep, fuse the results, and compare
   fused-output macro-F1 against vision-alone macro-F1 on those same reps.
2. **Only adopt the ensemble over vision-alone if it clearly beats it** --
   same "don't promote on a nominal difference" bar already used for the
   vision model's synthetic-augmentation experiment (required the new
   result's lower ±1-std bound to clear the baseline's upper ±1-std bound)
   and the RandomForest-vs-LogisticRegression comparison for the IMU
   model. Never assume fusion helps just because two signals exist --
   two weak, correlated, or miscalibrated signals can combine to something
   worse than either alone.
3. Re-tune `DEFAULT_VISION_WEIGHT` from that data if warranted, replacing
   the current fixed 80/20 policy choice with an empirically justified one
   -- and document the change with the same honesty as every other
   decision in this project's history.
