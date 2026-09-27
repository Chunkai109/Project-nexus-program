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

## Files

```
data/imu_raw/            # 35 raw Test N.txt logs (gitignored, not committed)
data/processed/imu_sessions.csv  # long-format per-frame parse of all 35 sessions
data/imu_labels.csv       # test_id, rep_index, start_frame, end_frame, label, label_source, notes
data/dataset_report.json  # class counts + the two note_on_* provenance disclosures above
src/parse_log.py          # raw log -> ImuSession (per-frame arrays)
src/segment.py            # peak-detection rep segmentation (tests 31-35 only)
scripts/prepare_dataset.py  # runs the whole pipeline above end to end
```

## Not yet done

- **No classifier has been trained yet.** This stage only produces labeled,
  structured data (52 labeled rep-rows total: 30 whole-session + 22
  segmented). The next step is feature engineering (e.g. aggregate
  stats over `flex`/`drift`/`emg` per rep, mirroring `ml/src/features/
  engineer.py`'s approach) and a small-data-appropriate model (likely
  RandomForest again, given the precedent in `ml/`).
- **No "Swing" or "Incomplete" examples exist in this data at all** --
  only Perfect/Heave/Half/Drag are represented. Any IMU classifier trained
  on this data can only ever predict among the classes actually present.
- **Only 52 labeled rows total, from 35 raw sessions and only 3-4
  distinct people/sessions worth of real variety** -- expect this dataset
  to hit the same small-data ceiling `ml/` extensively documented (see
  `ml/README.md`'s regularization search and synthetic-augmentation
  sections), likely sooner given it's smaller than the 34-recording
  vision training set.
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
