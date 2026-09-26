# Bicep curl form classifier (MediaPipe Pose)

Classifies a complete dumbbell bicep-curl repetition, from MediaPipe Pose
landmarks, into one of 6 real quality classes:
**Perfect, Drag, Swing, Half, Heave, Incomplete**.

## Dataset

`bicep_with_incomplete.csv` (not committed -- see `data/raw/`): 726
`video_id` rows, each a curl repetition's MediaPipe Pose **world landmarks**
(33 joints x,y,z per frame). Inspection found only **49 independent source
recordings** -- most stored 11 times (1 `_orig` + 10 pre-generated `_aug_*`
copies). All splitting is done on the 49 `base_id`s so a recording's
augmented copies never cross train/val/test (see
`src/preprocessing/dataset_io.py`).

**The "Incomplete" class needed extra care, not just a retrain.** 17 of the
49 recordings (all labeled "Perfect") are ALSO present as
`incomplete_vid_00NN_*` rows -- verified by direct byte comparison to be the
exact same frame data, truncated to a randomized fraction (~19%-83%) of the
full recording, not an independent performance. That means a single
`base_id` can now carry TWO different class labels (its real performance
class, and "Incomplete" if it's one of the 17). Two things had to be fixed
for this to be safe:
- **Leakage**: the base_id regex now matches "vid_00NN" wherever it appears
  in the string (not just at the start), so `incomplete_vid_0025_aug_3` and
  `vid_0025_aug_3` resolve to the same `base_id` and can never land in
  different splits -- they are byte-identical over their shared prefix, so
  splitting them apart would have put the same frames in both train and test.
- **Stratification**: the split is stratified by each base_id's *primary*
  (non-Incomplete) label, since a base_id can't be cleanly assigned a single
  class anymore. Splitting is still by base_id, so wherever a recording
  lands, its Incomplete truncations automatically go with it.

No verified subject/person identifier exists in the data; `base_id`
identifies a *recording*, not a confirmed-unique human. This is disclosed
in `data/processed/dataset_report.json`, not glossed over.

## Pipeline

```
raw MediaPipe world landmarks (33,3)
  -> SequenceNormalizer   (scale-normalize, canonicalize working arm)
  -> FeatureExtractor     (8 engineered features: ROM, torso lean, elbow drift, ...)
  -> aggregate_sequence_features()  (per-sequence summary stats)
  -> RandomForest / XGBoost  ->  class + confidence
```

An LSTM (3 input-channel variants: raw landmarks / engineered features /
combo) was trained and compared per the project's model-selection protocol
-- see `scripts/train.py`'s inline comments and
`results/classification_report/all_candidates_comparison.json`. The
raw-landmark LSTM scored highest on validation but was **excluded** after
diagnosis showed it was very likely exploiting recording/session-level
pose artifacts rather than genuine curl-quality signal (a purely static,
non-temporal snapshot already separated classes almost as well, and its
test accuracy exceeded its train accuracy). The final shipped model is a
RandomForest on the engineered, scale/position-invariant features, whose
top feature importances line up with the actual class definitions (ROM ->
Half, elbow drift -> Drag, torso-lean variability -> Swing/Heave).

## Headline generalization number

**Report the 5-fold GroupKFold CV macro-F1 (0.885 ± 0.049 over the
34-recording dev pool), not the held-out test accuracy, as the model's
expected real-world performance.** The test split is only 8 independent
recordings -- a single point estimate there (98.4% acc / 0.99 macro-F1)
isn't statistically reliable on its own. `training_config.json`'s
`"headline_generalization_metric"` field carries this number and caveat
programmatically; `scripts/evaluate.py` prints it prominently for the same
reason. Adding the "Incomplete" class *did* meaningfully help the
overfitting picture found in the earlier diagnosis: the reduced (top-20-of-41)
feature set now genuinely wins the regularization search (0.885 vs. 0.855
for the original full-feature setting), and the train-vs-CV gap shrank from
~0.14 to ~0.10.

**`sequence_length` is now the #1 most important feature** (it ranked 35th
of 41 and was nearly irrelevant before Incomplete existed). This is
legitimate, not a bug -- "Incomplete" is defined by premature stopping, so
raw frame count is a genuinely predictive signal for it. But it meant live
inference depended on the buffered session's frame *count* correlating with
real elapsed time, i.e. on the live capture rate being in the same ballpark
as whatever (unknown, undocumented) rate the training clips were captured
at -- a much higher live capture FPS could make even a genuinely complete
rep produce more frames than any training example.

**Fixed**: `BicepCurlPredictor` now measures real wall-clock duration during
a live session and converts it to an *equivalent* frame count at an assumed
reference rate (`ASSUMED_TRAINING_FPS = 24.0` in `predictor.py`, a
documented guess -- ~71 frames average for a training "complete" rep over a
plausible ~3s deliberate curl implies something in the 20-30fps range; 24fps
is a common recording default) instead of using the raw number of frames
the live loop happened to process. This decouples the feature from local
processing speed, leaving only the smaller, unavoidable uncertainty of the
training data's actual (unknown) capture rate. Only applies to genuine live
sessions -- disabled (`use_wallclock_duration=False`) when replaying
already-recorded frames (`scripts/predict.py`, `predict_full_sequence()`),
where the raw frame count is already correct and wall-clock replay time is
meaningless (frames are replayed instantly, not paced in real time).

## No-exercise / non-curl rejection (two gates)

The classifier's classes are all bicep-curl-specific -- there was no way for
it to say "this isn't a curl at all," so standing still, or a different
exercise, was forced through it, sometimes with deceptively high confidence
(a near-zero range of motion looks like an extreme case of "Half"). Two
complementary gates run before the classifier ever sees the input:

1. **Rest gate** (`rest_gate_config.json`, unchanged from before) catches
   near-*zero* motion -- a physical floor derived from the weakest
   *complete* repetition across all 49 recordings ("Incomplete" rows are
   excluded from this floor; they include truncations down to ~19% of the
   motion, which would otherwise collapse the threshold toward zero).
   Returns `prediction: "no_exercise_detected"`.

2. **Novelty/outlier detector** (`scripts/train.py`'s
   `build_novelty_detector()`, new) catches real movement that still
   doesn't statistically resemble any bicep curl -- a different exercise or
   arbitrary arm movement with genuine motion, which the rest gate's 1-2
   ROM thresholds can't see. An `IsolationForest` is fit on the full
   41-feature profile of every dev-pool sequence (all 6 classes count as
   "genuinely a curl," including truncated "Incomplete" ones -- no negative
   training data is needed for novelty detection, only a definition of
   in-distribution). Returns `prediction: "unrecognized_movement"`.

   **Tested and honestly limited**: an erratic-flailing and an
   overhead-arm-raise simulation were both correctly caught. A
   lateral-raise-style simulation (moderate amplitude, still changes elbow
   angle somewhat) was **not** caught at the shipped threshold. Checked the
   actual tradeoff empirically against the real dev/test data before
   picking a threshold:

   | false-reject rate | threshold | real test-set false rejects | catches lateral-raise sim? |
   |---|---|---|---|
   | 2% (shipped) | -0.101 | 0/121 | no |
   | 5% | -0.044 | 1/121 | no |
   | 8% | -0.019 | 6/121 | yes |
   | 10% | -0.009 | 15/121 | yes |

   Catching subtler non-curl movement requires a threshold that also
   falsely rejects real (if poor-quality) reps -- there's no free lunch at
   only 41 dev-pool recordings. Shipped with the conservative 2% (zero false
   rejects on real held-out data); `build_novelty_detector`'s
   `false_reject_rate` parameter is the knob if broader coverage is wanted
   at the cost of more false rejects on genuine attempts.

## Reproducing

```bash
python -m ml.scripts.prepare_dataset --csv /path/to/bicep_with_incomplete.csv
python -m ml.scripts.train
python -m ml.scripts.evaluate
python -m ml.scripts.predict --csv /path/to/bicep_with_incomplete.csv
```

## Structure

```
data/raw/            # place reduced.csv here (git-ignored, not committed)
data/processed/      # prepare_dataset.py outputs (features, splits, reports)
models/best_model/   # trained model + training_config.json + candidates/
results/             # confusion matrices, classification reports, curves
src/preprocessing/    # landmark schema + causal normalization (shared train/inference)
src/features/         # causal feature engineering (shared train/inference)
src/models/           # LSTM model/dataset + fixed label mapping
src/inference/        # BicepCurlPredictor -- live/streaming inference
scripts/              # prepare_dataset.py, train.py, evaluate.py, predict.py
```
