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

### Second data batch (tests 36-41): Swing and Incomplete

User-provided recordings ("Swing DataSet" / "Incomplete Dataset"), added to
cover two classes this dataset originally had zero examples of. These come
from a **reduced logging format** -- just `Flex: x.x | Drift: y.y` per
line, no `State`/`EMG`/`Vib`/`Reps` (see `parse_log.py`'s
`FLEX_DRIFT_ONLY_RE`) -- so `emg`/`vib_on` for these 6 sessions are 0/False
by *convention* (not recorded), not a real silent-EMG reading;
`imu_sessions.csv`'s `has_emg_vib_state` column flags exactly which rows
this applies to, and `dataset_report.json`'s
`tests_without_real_emg_vib_data` lists the test_ids.

**Swing (tests 36-40, all 5 used)**: checked directly against the existing
35-session dataset before labeling, not accepted on the folder name alone.
`Drift` sits at a near-constant -43..-53 across all 5 sessions -- narrow
within each session (6-10 units of variation) but ~40 units away from
every other class's range (-14 to +33), including **this same upload
batch's own Incomplete recording** (-6.7 to +9.5, a normal range). That
contrast is what makes this look like a sensor-calibration/mounting
difference specific to how Swing was recorded, rather than genuine
swing-motion signal -- a real body swing should make `Drift` *fluctuate*
as the torso rocks, not sit at a stable shifted offset. Trained on as-is
per an explicit decision (not silently accepted or silently excluded) --
see "Trained classifier" below for the drift-ablation check this prompted
and what it found.

**Incomplete (test 41 only, of 5 candidates)**: the other 4 candidate
recordings were checked for whether they actually show a rep cut off
mid-motion (the class's definition) by comparing where each recording
*ends* relative to its own baseline and peak. Four of the five end back
near their own starting baseline -- a completed rise-and-return cycle,
which is a normal-rep signature, not a truncated one -- and were excluded
rather than mislabeled, the same reasoning already applied elsewhere in
this dataset to not fabricating labels that contradict their own evidence.
Only test 41 ends genuinely elevated (56% of the way from its baseline to
its peak), consistent with the recording stopping before the rep finished.
This leaves Incomplete with exactly **one** real example -- see "Trained
classifier" and "Novelty gate" below for what that does to the CV number
and the novelty gate specifically.

## Trained classifier

A RandomForest trained on 19 per-rep aggregate features (`src/features.py`:
mean/std/min/max/range of `flex` and `drift`, mean/std/max of `emg`,
`vib_on` fraction, causal-velocity mean/std for `flex`/`drift`, and
`num_frames`). No LSTM was trained or compared -- `ml/`'s vision model
already established, with 34 training recordings, that a raw-landmark LSTM
loses to RandomForest and shows shortcut-learning symptoms; this dataset
has fewer independent groups, making an LSTM comparison here an even more
foregone conclusion, skipped explicitly rather than silently.

**Headline metric (current, 6-class dataset): 5-fold GroupKFold macro-F1
(group=`test_id`) = 0.822 +/- 0.022.** No ceiling effect this time -- a
real, meaningful change from the original 4-class version of this dataset,
which hit a suspicious 1.000 across every setting tested (see "History:
the original 4-class ceiling effect" below). The score dropping below 1.0
isn't a regression -- it's what an honest CV number looks like once a
class exists with too little data to cross-validate cleanly:
**`Incomplete` has exactly 1 example (1 group)**, so in whichever CV fold
holds it out as validation, the training split has *zero* Incomplete
examples at all -- the model literally cannot predict a class it never
saw, dragging that fold's macro-F1 down. `training_config.json`'s
`class_dropout_notes` records this explicitly (`"fold 2: training split is
missing class(es) ['Incomplete'] entirely"`) rather than letting it pass
silently.

**Per-class breakdown** (from out-of-fold CV predictions, not the CV
macro-F1 average, which hides this):

| Class | Groups | Precision | Recall | F1 |
|---|---|---|---|---|
| Perfect | 15 | 1.00 | 1.00 | 1.00 |
| Drag | 7 | 1.00 | 1.00 | 1.00 |
| Half | 13 | 1.00 | 1.00 | 1.00 |
| Heave | 5 | 1.00 | 1.00 | 1.00 |
| Swing | 5 | 0.83 | 1.00 | 0.91 |
| Incomplete | **1** | 0.00 | 0.00 | 0.00 |

Perfect/Drag/Half/Heave (5-15 groups each) still separate cleanly -- the
original ceiling-effect classes didn't get *worse*, the macro-F1 number
just no longer hides the two classes that genuinely aren't ready yet.

**Swing-specific check, done deliberately, not skipped**: Swing's 5
sessions show a `Drift` signal sitting at a near-constant -43..-53,
outside every other class's range -- flagged as a likely sensor-
calibration artifact rather than confirmed swing motion (see "Second data
batch" below). Retrained with every `drift_*` feature removed to check
whether Swing recognition depends on it: **Swing's recall stayed 1.00 with
drift removed entirely** (F1 0.91, same as with drift included) --
`flex`'s own shape carries real signal for this class on its own. This is
reassuring, not a full clearance: `drift_max`/`drift_range`/`drift_mean`/
`drift_vel_std` still rank in the top 8 features by importance in the
*deployed* (all-features) model, so the shipped model still leans on the
suspect signal to some degree even though it isn't strictly required.
Removing drift *did* cost accuracy elsewhere (Drag's F1 dropped from 1.00
to 0.80 -- Drag's real elbow-flare signature genuinely needs drift), so
drift wasn't dropped from the shipped feature set; this is reported as a
known risk to monitor, not resolved.

**Logistic Regression comparison** (same labeled data, same features, same
GroupKFold protocol, `sklearn.linear_model.LogisticRegression` inside a
`Pipeline` with `StandardScaler`): 0.822 +/- 0.022 for the best config --
tied with RandomForest, not clearly better (decision protocol requires
beating RF's best by more than 1 std). **RandomForest stays the deployed
model** -- full comparison (both grids, every fold) is saved in
`training_config.json`'s `model_comparison` block.

### History: the original 4-class ceiling effect

Before Swing/Incomplete existed, this classifier (Perfect/Drag/Half/Heave
only, 35 sessions) hit a suspicious **1.0000 CV macro-F1 across every
regularization setting tested, including the fully unregularized
baseline** -- read as a red flag, not a win, the same skepticism this
project applied to the vision model's raw-landmark LSTM hitting 100% test
accuracy. Confirmed directly: `drift_max` alone separated Drag from every
other class with a huge gap, and `flex_range` separated Half and Heave
from the rest almost as cleanly -- a 2-threshold decision tree already got
this perfectly. Logistic Regression also hit exactly 1.0 across every `C`
tested, further evidence for (not against) the diagnosis: both a shallow
tree and a linear boundary separating the data perfectly means the classes
are trivially separable in this feature space, exactly what a
mechanically-constructed, single-person, deliberately-exaggerated test
protocol produces -- not evidence of real generalization. Adding Swing/
Incomplete didn't fix the underlying small-sample fragility (if anything,
Incomplete's 1 example is an even more extreme version of it) -- it just
means the current CV number can no longer hide behind averaging, which is
a more honest state than before, not necessarily a "better" one.

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

**Concrete, honest finding after adding Swing/Incomplete**: replaying all
58 labeled reps through the retrained gate rejects 2 -- one Swing example
(`test_id=40`) and, notably, **the single Incomplete example itself**
(`test_id=41`). That means right now, even the one real piece of evidence
this classifier has for "Incomplete" sits far enough into the novelty
score's extreme tail that the gate -- fit on that same example, among
everything else -- flags it as unrecognized rather than letting the
classifier see it. Practically: expect the live system to often report
`unrecognized_input` rather than `Incomplete` for a genuinely incomplete
rep today, until more Incomplete examples exist to give the gate (and the
classifier) a less lonely point of reference.

**How to test it** -- no IMU hardware needed, exactly like the vision
model's `ml/scripts/predict.py`:

```bash
python -m ml_imu.scripts.train      # (re)trains the model, prints the CV breakdown above
python -m ml_imu.scripts.predict                 # replay all 58 labeled reps
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
data/imu_raw/            # 41 raw Test N.txt logs (gitignored, not committed)
                          # tests 1-35: full State/Flex/Drift/EMG/Vib/Reps format
                          # tests 36-41: reduced Flex/Drift-only format (2nd batch)
data/processed/imu_sessions.csv  # long-format per-frame parse of all 41 sessions,
                          # + has_emg_vib_state column (False for tests 36-41)
data/imu_labels.csv       # test_id, rep_index, start_frame, end_frame, label, label_source, notes
data/dataset_report.json  # class counts + provenance disclosures, incl. which
                          # tests lack real EMG/Vib data
models/best_model/        # model.joblib + training_config.json (CV metric, class
                          # dropout notes, feature importance)
                          # + novelty_detector.joblib/_config.json + feature_reference_stats.json (novelty gate)
src/parse_log.py          # raw log -> ImuSession (per-frame arrays); handles both
                          # the full and reduced log formats
src/segment.py            # peak-detection rep segmentation (tests 31-35 only)
src/features.py           # per-rep aggregate feature engineering
src/labels.py             # CLASS_NAMES <-> index mapping (all 6 vision-model classes)
src/predictor.py          # ImuCurlPredictor -- loads the saved model, classifies one rep's arrays
scripts/prepare_dataset.py  # raw logs -> imu_sessions.csv + imu_labels.csv + dataset_report.json
scripts/train.py          # GroupKFold CV + regularization search, saves models/best_model/
scripts/predict.py        # replay recorded sessions through the trained model (no hardware needed)
```

## Not yet done

- **Swing and Incomplete are real but thin.** Swing has 5 sessions with an
  unresolved calibration-offset question on its `Drift` feature (see
  "Second data batch" above); Incomplete has exactly 1 example, too few
  for GroupKFold to say anything reliable about it, and that one example
  currently gets rejected by the classifier's own novelty gate (see
  "Novelty gate" above). Both need more real, independently-documented
  recordings before their numbers deserve the same trust as Perfect/Drag/
  Half/Heave's.
- **The 0.822 CV number is a small-sample-honesty result, not a validated
  real-world accuracy** -- it's real progress over the old ceiling effect
  (no more suspicious 1.0), but it's still one person, still a mechanically
  staged protocol for most classes. More real data, especially from more
  than one person, would be needed before this means anything close to
  what 88.5% CV macro-F1 means for the vision model.
- **No synchronized dual-sensor recordings exist.** The vision dataset and
  this IMU dataset were collected completely separately (different
  sessions, not the same reps). Before the fusion layer's real-world
  benefit can be honestly checked, a batch of recordings with the camera
  and this wearable device running *simultaneously on the same reps* is
  needed -- not to retrain either base model, just to validate and tune
  how their two predictions should be combined.
- **The fusion layer now blends over all 6 classes** (`ensemble/src/
  fusion.py`'s `SHARED_CLASSES`), including Swing/Incomplete -- a
  capability change, not a validated-improvement one. See
  `ensemble/README.md` for the current state of that layer.
