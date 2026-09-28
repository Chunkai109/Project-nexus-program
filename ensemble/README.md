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
   Heave/Incomplete); the IMU model only covers 4 (no real Swing/
   Incomplete data exists for it, and fabricating that data was explicitly
   rejected as circular/dishonest -- the same reasoning already applied to
   declining synthetic label generation for `ml_imu/`'s original dataset).
   **Resolution**: fuse probabilities only over the 4 `SHARED_CLASSES`. If
   vision's own top prediction is Swing or Incomplete, IMU is not
   consulted at all -- blending in an opinion IMU was never trained to
   give would be meaningless, not conservative.

2. **Weighting**: heavily favor vision, **80/20 by default**
   (`DEFAULT_VISION_WEIGHT`). This reflects the real, current honesty gap
   between the two models: vision has an independently-validated ~88.5%
   GroupKFold CV macro-F1; the IMU model's 100% CV number was diagnosed as
   a ceiling effect (both RandomForest and Logistic Regression hit it
   identically, confirming it's the data's trivial separability, not
   either model's skill) and is not a validated accuracy claim. 80/20 is a
   documented policy choice, not a value fit to data -- there is no
   synchronized data to fit it to.

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
- `"vision_only_exclusive_class"` -- vision's top class is Swing/Incomplete; IMU's opinion is attached for transparency but not used in the decision.
- `"fused"` -- both models had a real say; `class_probabilities` is the weighted blend over the 4 shared classes (renormalized after dropping vision's Swing/Incomplete mass -- the exact amount dropped is stated in the returned `"message"`), and a `good_form_score` is derived by running the blended P(Perfect) through vision's existing calibration anchor (an approximation, since that anchor was tuned for vision's raw output alone, not a blend).

Every branch includes the raw `vision_result` and `imu_result` unmodified,
so nothing is hidden behind the fused number.

## How to run it

```bash
python -m ensemble.scripts.demo_fusion                                    # logic tests only
python -m ensemble.scripts.demo_fusion --csv /path/to/bicep_with_incomplete.csv  # + real-data smoke test
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

## Future validation plan (not done yet)

Once synchronized recordings exist (camera + wearable device running
simultaneously on the same real reps, with ground-truth labels):
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
