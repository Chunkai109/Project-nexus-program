# Bicep curl form classifier (MediaPipe Pose)

Classifies a complete dumbbell bicep-curl repetition, from MediaPipe Pose
landmarks, into one of the PhysioVision dataset's real quality classes:
**Perfect, Drag, Swing, Half, Heave**.

## Dataset

`reduced.csv` (not committed -- see `data/raw/`): 539 `video_id` rows, each a
full curl repetition's MediaPipe Pose **world landmarks** (33 joints x,y,z
per frame). Inspection found only **49 independent source recordings** --
each stored 11 times (1 `_orig` + 10 pre-generated `_aug_*` copies). All
splitting is done on the 49 `base_id`s so a recording's augmented copies
never cross train/val/test (see `src/preprocessing/dataset_io.py`).

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

## Reproducing

```bash
python -m ml.scripts.prepare_dataset --csv /path/to/reduced.csv
python -m ml.scripts.train
python -m ml.scripts.evaluate
python -m ml.scripts.predict --csv /path/to/reduced.csv
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
