# IMU/EMG bicep-curl form dataset (separate pipeline from `ml/`)

This is a **fully independent pipeline** from `ml/` (the MediaPipe-Pose-based
vision classifier) -- different sensor modality, different data, different
model, kept in its own directory on purpose. Deployment will eventually run
both a camera and this wearable device simultaneously on the same rep, and
combine their two predictions in a late-fusion ensemble -- but that fusion
step, and the IMU classifier itself, are **not built yet**. This stage is
data preparation only: parsing the raw device logs and attaching quality
labels. See "Not yet done" below for what's still ahead.

## The raw data

35 console-log sessions (`Test 1.txt` .. `Test 35.txt`) from a wearable arm
device: a bend/flex sensor across the elbow, a secondary gyro-derived angle
("Drift"), an EMG (muscle activation) sensor, and the device's own onboard
rule-based state machine (`State: DOWN/CURLING/TOP`, a `Reps` counter, and a
`Vib: ON/OFF` vibration alert). One line per sample:

```
State: DOWN    | Flex:   2.7 | Drift:  -1.6 | EMG: 1967 | Vib: OFF | Reps: 0
```

Not committed to git (`ml_imu/data/imu_raw/*` is gitignored, matching
`ml/data/raw/`'s existing pattern) -- place the extracted `Test N.txt`
files there and run `python -m ml_imu.scripts.prepare_dataset`.

## Labels: where they came from, and why this isn't circular

**The raw logs have no quality labels at all** (no Perfect/Drag/Swing/etc.)
-- just sensor readings and the device's own rep counter, which turned out
to be unreliable (see below). The labels in `imu_labels.csv` come from the
user's own session notes -- what was actually, deliberately done in each
test, written down independently of the sensor data. **This is the
important distinction**: the sensor-pattern statistics documented below
(flex_range, drift range, reached_top) are a *corroborating consistency
check* on those independently-provided labels, not their source. Defining
a label from a threshold on the same kind of feature a classifier would
later train on would be circular -- the model would just relearn the
threshold, not measure anything real. That trap is exactly why the
project's very first candidate dataset (synthetic mocap with no real
labels) was rejected early in `ml/`'s history, and it's avoided here the
same way: real, independent ground truth first, sensor evidence used only
to sanity-check it.

### Whole-session labels (tests 1-30)

| tests | user's note | label | corroborating evidence |
|---|---|---|---|
| 1-5 | normal speed | Perfect | full ROM, reaches `TOP` every time |
| 6-10 | fast (deliberate momentum) | Heave | `flex_range` ~101-115 vs ~124-157 elsewhere -- less controlled, truncated ROM |
| 11-15 | slow, still correct form | Perfect | full ROM, reaches `TOP` every time |
| 16-23 | half reps | Half | `flex_range` drops to ~53-72 (vs ~124-157 elsewhere), **never reaches `TOP`** |
| 24-30 | elbow flare | Drag (closest existing class) | `Drift` spikes to +21..+33 vs roughly [-14,+8] everywhere else |

### Segmented labels (tests 31-35): "multiple reps without fully putting hands down"

These five files can't get one whole-file label the way 1-30 do. Checked
directly: the device's `State` field transitions `DOWN -> CURLING -> TOP`
only **once** per file, then stays `TOP` for the rest of the (800+ line)
session while `Flex` keeps fluctuating -- several real reps happen inside
one sustained "TOP" state, invisible to the device's own state machine.
That's also why its `Reps` counter reads 0 for all five files throughout.

Segmented instead via prominence-thresholded peak detection directly on the
raw `Flex` curve (`ml_imu/src/segment.py`, wrapping
`scipy.signal.find_peaks(flex, prominence=20, distance=40)`). This was
chosen over naive velocity (first-difference) zero-crossing, which was
tried first and produced noisy, spurious crossings during static/settling
periods -- confirmed empirically, not assumed. The tuned parameters give
clean, evenly-spaced peaks in every file (4-5 reps each, matching a
plausible rep count for these sessions).

Within each segmented file, **rep_index 0 is labeled "Perfect" and every
later rep "Half"** -- not a uniform label. This was corrected mid-process
after the data showed a clean, non-overlapping split: rep 0 always starts
from the device's true calibrated "arm hanging down" baseline (before any
curling happened), and its `flex_range` is always ~122-128 across all 5
files -- squarely matching the full-ROM Perfect/Heave/Drag groups above.
Every later rep starts from wherever the previous rep left the arm (never
fully lowered), and its `flex_range` is always ~64-83 -- squarely matching
the Half group's 53-72. No file's reps straddle that gap. `label_source`
in `imu_labels.csv` records `"peak_detection_segmented"` for these rows
(vs. `"manual_full_session"` for tests 1-30) so the two provenances stay
distinguishable in any later analysis.

## Trained classifier

A RandomForest trained on 19 per-rep aggregate features (`src/features.py`:
mean/std/min/max/range of `flex` and `drift`, mean/std/max of `emg`,
`vib_on` fraction, causal-velocity mean/std for `flex`/`drift`, and
`num_frames`). No LSTM was trained or compared -- `ml/`'s vision model
already established, with 34 training recordings, that a raw-landmark LSTM
loses to RandomForest and shows shortcut-learning symptoms; this dataset
has fewer independent groups (35 sessions, several classes with only 5-8
groups), making an LSTM comparison here an even more foregone conclusion,
skipped explicitly rather than silently.

**Headline metric: 5-fold GroupKFold macro-F1 (group=`test_id`) = 1.0000,
across every regularization setting tested, including the fully
unregularized baseline.**

**Read this number as a red flag, not a win.** This project treated the
vision model's raw-landmark LSTM hitting 100% test accuracy as suspicious
(shortcut learning), not celebrated -- the same skepticism applies here,
more so. Confirmed directly by inspecting the feature distributions:
`drift_max` alone separates Drag (21.5-32.7) from every other class (max
~12.7 elsewhere) with a huge gap, and `flex_range` separates Half (53-83)
and Heave (101-115) from the rest almost as cleanly. A 2-threshold decision
tree already gets this perfectly (confirmed: `max_depth=2` scores exactly
the same 1.0 as an unregularized forest). **This is a mechanical
consequence of the test protocol** -- one person performing deliberately
extreme, distinct demonstrations of each error type -- not evidence the
model has learned anything robust or generalizable. It reliably tells
these 35 staged, exaggerated demonstrations apart from each other; it says
nothing about a different person, a genuinely ambiguous rep, or subtler
real-world form errors. No separate held-out test set is used at all for
this classifier, for the same reason `ml/`'s vision model uses CV as its
headline number over its own tiny test split, taken further: at only 35
raw sessions (as few as 5 for Heave), carving out a held-out split would
leave too few groups for either side to mean anything.

**Logistic Regression comparison** (same labeled data, same features, same
GroupKFold protocol, `sklearn.linear_model.LogisticRegression` inside a
`Pipeline` with `StandardScaler` since -- unlike RandomForest -- a linear
model is sensitive to feature scale): **also hits exactly 1.0 CV macro-F1
across every `C` value tested (0.01, 0.1, 1.0, 10.0)**, with no leakage
(the scaler is fit only on each fold's training split). This is not a
contradiction of the ceiling-effect finding above -- it's further evidence
for it. Both a shallow tree and a linear decision boundary separating this
data perfectly means the classes are cleanly separable in this feature
space by essentially any reasonable classifier, exactly what a
mechanically-constructed, single-person, deliberately-exaggerated test
protocol produces. Since Logistic Regression didn't *clearly* beat
RandomForest (the decision protocol requires beating RF's best by more
than 1 std, not just tying it), **RandomForest stays the deployed model**
-- full comparison (both grids, every fold) is saved in
`training_config.json`'s `model_comparison` block.

## Novelty gate (out-of-distribution detection)

Since this classifier's "knowledge" is really just one person's narrow
sensor range (see the ceiling-effect finding above), it had no way to
recognize input that doesn't resemble anything it was trained on -- it
would always confidently force a guess among the 4 known classes, even for
a different person's device fit or an unrelated signal. Fixed the same way
`ml/`'s vision model handles this: an `IsolationForest` fit on all 52
labeled reps' features (`src/predictor.py::ImuCurlPredictor`,
`scripts/train.py::build_novelty_detector`), gating classification behind
a `decision_function` threshold, plus per-feature z-score diagnostics
(`feature_reference_stats.json`) that show exactly which signal was
anomalous when something gets rejected.

**One honest difference from the vision model's version**: `ml/`'s
threshold was validated against genuinely held-out real test data (an
empirical false-reject-rate table). This dataset has no held-out data at
all -- every one of the 52 rows was used to fit both the classifier and
this detector, so the 2%-percentile threshold is a coarser, unvalidated
floor, not a tuned tradeoff. A direct consequence, confirmed by running it:
**replaying all 52 real training reps rejects 2 of them** (the single most
extreme "Perfect" and "Drag" examples) as `unrecognized_input` -- expected
behavior given the 2% design target, not a bug, but a concrete illustration
of how rough this floor is at this data scale. Tested against a genuinely
synthetic out-of-distribution input (flex/drift values far outside anything
recorded), it correctly rejected it with a large negative novelty score and
feature z-scores in the hundreds, confirming the mechanism works for real
anomalies, not just training-data edge cases.

This doesn't fix the underlying small-single-person-dataset limitation --
it contains the risk: instead of confidently misclassifying an
unrecognized input as one of the 4 known classes, the classifier now says
so explicitly.

**How to test it** -- no IMU hardware needed, exactly like the vision
model's `ml/scripts/predict.py`:

```bash
python -m ml_imu.scripts.train      # (re)trains the model, prints the CV breakdown above
python -m ml_imu.scripts.predict                 # replay all 52 labeled reps
python -m ml_imu.scripts.predict --test_id 31    # replay just one raw session's reps
```

`predict.py` replays already-recorded sessions through the trained model
and prints prediction vs. true label per rep. Because there's no held-out
split, this replay is illustrative of the pipeline running end-to-end
(and a way to sanity-check individual predictions), **not an independent
accuracy claim** -- the GroupKFold number above (with its ceiling-effect
caveat) is the one to trust, and even that comes with the caveat spelled
out above.

## Files

```
data/imu_raw/            # 35 raw Test N.txt logs (gitignored, not committed)
data/processed/imu_sessions.csv  # long-format per-frame parse of all 35 sessions
data/imu_labels.csv       # test_id, rep_index, start_frame, end_frame, label, label_source, notes
data/dataset_report.json  # class counts + the two note_on_* provenance disclosures above
models/best_model/        # model.joblib + training_config.json (CV metric, ceiling-effect warning, feature importance)
                          # + novelty_detector.joblib/_config.json + feature_reference_stats.json (novelty gate)
src/parse_log.py          # raw log -> ImuSession (per-frame arrays)
src/segment.py            # peak-detection rep segmentation (tests 31-35 only)
src/features.py           # per-rep aggregate feature engineering
src/labels.py             # CLASS_NAMES <-> index mapping (4 classes present in this data)
src/predictor.py          # ImuCurlPredictor -- loads the saved model, classifies one rep's arrays
scripts/prepare_dataset.py  # raw logs -> imu_sessions.csv + imu_labels.csv + dataset_report.json
scripts/train.py          # GroupKFold CV + regularization search, saves models/best_model/
scripts/predict.py        # replay recorded sessions through the trained model (no hardware needed)
```

## Not yet done

- **No "Swing" or "Incomplete" examples exist in this data at all** --
  only Perfect/Heave/Half/Drag are represented. This classifier can only
  ever predict among the classes actually present.
- **The 100% CV number reflects a nearly-trivially-separable task at this
  data's current scale/protocol, not validated real-world accuracy** --
  see "Trained classifier" above. More real data, especially from more
  than one person and without the deliberately-exaggerated distinct
  demonstration protocol, would be needed before this number means
  anything close to what 88.5% CV macro-F1 means for the vision model.
- **No synchronized dual-sensor recordings exist.** The vision dataset and
  this IMU dataset were collected completely separately (different
  sessions, not the same reps). Before any fusion/ensemble step can be
  built and honestly validated, a batch of recordings with the camera and
  this wearable device running *simultaneously on the same reps* is
  needed -- not to retrain either base model, just to validate and tune
  how their two predictions should be combined.
- **The fusion/ensemble logic itself** is unbuilt and unscoped beyond the
  recommendation to prefer simple weighted probability averaging over a
  learned stacking meta-model, given how little data either side has.
