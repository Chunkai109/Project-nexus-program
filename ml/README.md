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

**New caveat this surfaced: `sequence_length` is now the #1 most important
feature** (it ranked 35th of 41 and was nearly irrelevant before Incomplete
existed). This is legitimate, not a bug -- "Incomplete" is defined by
premature stopping, so raw frame count is a genuinely predictive signal for
it. But it means live inference now depends more than before on the
buffered session's frame *count* correlating with real elapsed time, i.e.
on the live capture rate being in the same ballpark as whatever rate the
training clips were captured at (unknown -- no fps metadata exists in the
CSV). A much higher live capture FPS could make even a genuinely complete
rep produce more frames than any training example, or make a genuinely
incomplete attempt look artificially "long enough." Not yet fixed --
worth normalizing by wall-clock duration instead of raw frame count if this
turns out to matter in practice.

## No-exercise rejection gate

The classifier's classes are all bicep-curl-specific -- there was no way for
it to say "this isn't a curl at all," so standing still (or any non-curl
motion) was forced through it, sometimes with deceptively high confidence (a
near-zero range of motion looks like an extreme case of "Half"/"Incomplete").
`scripts/train.py`'s `build_rest_gate_config()` derives a motion-magnitude
floor from the weakest *complete* repetition across all 49 source recordings
(the "Incomplete" class is deliberately excluded from this floor -- it
contains reps truncated after as little as ~19% of the motion, which would
otherwise collapse the threshold toward zero) and saves it to
`models/best_model/rest_gate_config.json`; `BicepCurlPredictor.end_session()`
checks it before ever calling the classifier, returning
`prediction: "no_exercise_detected"` (no fabricated class or confidence)
when a session shows no real curling motion on any gate signal. Note this
gate only catches near-*zero* motion -- it does not detect a different,
non-curl exercise performed with real movement (e.g. a lateral raise); that
remains an open gap (a novelty/outlier detector over the full feature
profile, fit on all in-distribution curls, was proposed as the next step
for that but is not yet implemented).

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
