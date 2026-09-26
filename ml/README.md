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

## Duration-independent live inference (best-window search)

Live field testing after the FPS fix above still showed `sequence_length`
as the single most abnormal feature almost every session -- by a wide
margin (z-scores of +3 to +20 across dozens of live reps) -- because the
predictor classified the **entire** buffered session (everything between
pressing `s` and `e`) as one repetition. Training's `sequence_length` only
ranges [11, 86] frames (~0.46-3.6s at the assumed 24fps reference); any
live session where the user took noticeably longer -- which happened
almost every time in practice -- made this, the classifier's #1-importance
feature, wildly out-of-distribution and dragged the whole prediction toward
"Swing"/rejected regardless of how the movement itself actually looked.

**Fixed differently this time**: rather than asking users to time their
reps precisely (tried, and unreliable in practice), `BicepCurlPredictor`
now searches sub-windows of the buffered live capture and reports whichever
one looks most like a good repetition
(`_end_session_with_window_search()` in `predictor.py`). Candidate window
durations span a grid a bit wider than training's own `sequence_length`
range (0.4s-4.0s in 0.25s steps), converted to frame counts via the
session's own estimated live fps (`frames_buffered / wallclock_duration`),
slid across every plausible start offset. All candidates are scored in one
batched call to the rest gate, novelty detector, and classifier (not
one-by-one -- ~1000 candidate windows over a 470-frame buffer took ~0.3s in
testing, see `scripts/verify_best_window_search.py`), and the passing
window with the highest `good_form_score` is returned, along with
`best_window_start_seconds`/`best_window_end_seconds`/
`num_windows_evaluated` so the caller can show which part of the capture
was judged. If no window passes the rest gate or novelty detector, the
result falls back to the whole-session gate outcome (`no_exercise_detected`
/ `unrecognized_movement`), unchanged from before.

**This only applies to live sessions** (`use_wallclock_duration=True`).
Recorded-sequence replay (`scripts/predict.py`, `predict_full_sequence()`)
keeps the exact original single-shot behavior -- verified as unchanged
(same `num_frames`, no best-window fields) by
`scripts/verify_best_window_search.py`'s regression check -- so the
project's headline CV metric and test-set evaluation protocol are
untouched by this change.

**Honest tradeoff, not hidden**: searching many overlapping windows and
keeping the best is a real multiple-comparisons effect -- some optimism
bias is expected and is intentional (report the user's best rep-like
segment within the capture, not an average diluted by extra buffer time,
which is what was actually asked for), not a claim that live accuracy
improved by this amount in general. A session with genuinely poor form
throughout still has no good window to find, so this doesn't inflate
scores for uniformly bad reps -- it only rescues good reps that were
previously diluted by an overlong capture. In one concrete test
(`verify_best_window_search.py`, a real TEST-split "Perfect" recording
padded with 300 idle frames to simulate a 12-second "took too long"
session): the unpadded single-shot baseline scored `good_form_score=0.72`;
the padded session scored `0.87` with the same correct "Perfect"
prediction, from a 2.4s window the search located inside the 12s capture.

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

## Synthetic augmentation of the training split (tried, did not help)

The training set is only 34 independent recordings, and no more real data is
available. The dataset's pre-generated `_aug_0`..`_aug_9` copies already vary
playback speed (±20%), body scale (±10%), and per-coordinate noise
(std ≈0.013–0.02m), but never camera angle or non-uniform tempo. Two new
transform types were built to fill that gap, in `synthetic_augment.py`:

- **Rotation**: rigid rotation about the vertical axis through the hip
  center, uniform `[-15°, +15°]` per copy. A rigid transform, so
  `torso_scale` and every joint-angle feature (`elbow_angle_active`,
  `elbow_angle_other`, `torso_lean_angle`) are exactly preserved
  mathematically -- verified with a regression test
  (`scripts/verify_synthetic_augmentation.py`) showing <3e-14 deviation on
  those features for a rotated copy, while `elbow_forward_drift_active` (a
  raw x-axis projection, not rotation-invariant) changes as expected.
- **Segment time-warp**: split into up to 3 roughly-equal segments and
  resample each independently at its own speed factor (uniform
  `[0.80, 1.25]`), simulating asymmetric tempo (e.g. a slower controlled
  negative) that the existing uniform-speed augmentation can't express.

5 extra copies per training-split source recording (`--n-synthetic-extra`),
generated **only from `_orig` sequences already assigned to `train`** --
the base_id split is computed first, from the 49 real recordings alone,
*before* any synthetic copy exists, so synthetic copies can never leak into
val/test. Verified two ways: an in-code assertion
(`synthetic sequences leaked outside the train split`) that would fail
loudly, and a regression check confirming `base_id_split.json` and the
val/test row counts in `sequence_features.csv` are byte-identical with
`--n-synthetic-extra 0` vs `5`.

**Result: none of the three configurations beat the committed baseline.**
Each was trained as an isolated `--tag`ged experiment (own
`data/processed_<tag>/`, `models/best_model_<tag>/`, gitignored) so the
comparison never touched the committed model, and promotion required the
new run's CV macro-F1 lower ±1-std bound to clear the baseline's upper
±1-std bound -- not just a nominally higher number:

| configuration | dev-pool CV macro-F1 | train-vs-CV gap | clears promotion bar? |
|---|---|---|---|
| **baseline (committed, no synthetic extras)** | **0.8850 ± 0.0487** | 0.101 | -- |
| rotation only (`synth_rotation`) | 0.8726 ± 0.1036 | 0.119 | no |
| time-warp only (`synth_warp`) | 0.8438 ± 0.1023 | 0.149 | no |
| both combined (`synth_both`) | 0.8712 ± 0.0980 | 0.120 | no |

All three came in at or below the baseline's point estimate *and* roughly
doubled its CV fold-to-fold variance (std ≈0.10 vs. 0.049) -- consistent
with adding more redundant copies of the same 34 underlying performances
diluting each GroupKFold fold's effective diversity rather than adding real
new information. `sequence_length` stayed the #1 feature by importance and
`reduced`/`random_forest` stayed the winning classical setting in every
tagged run, so there's no structural drift to explain away -- the
augmentation itself simply didn't generalize better. Per-joint noise and an
N=3/N=8 sensitivity sweep (planned as follow-ups only if rotation/warp
showed a real effect) were not run, since none did. **The committed
baseline (`data/processed/`, `models/best_model/`, `results/`) is
unchanged** -- this was a genuine search with a negative result, reported
the same way the earlier regularization search was.

**This was always going to be a mitigation, not a fix, even in the best
case.** Rotating and time-warping already-reconstructed 3D landmarks is not
the same as re-filming from a different angle and re-running MediaPipe's
own angle-dependent pose estimator on new pixels -- it cannot introduce the
real angle-dependent noise, occlusion, or estimation error a genuinely new
camera position would produce, and because no additional real data exists
at all (not even a small hand-labeled validation set), any such improvement
could only ever be checked against synthetic variants of the same 34
recordings, never confirmed under real camera or lighting conditions. That
ceiling turned out to bind immediately: the negative result above is
consistent with "more synthetic copies of the same 34 performances" simply
not being a substitute for independent real data, not with a bug in the
transforms (which passed their own correctness checks independently, see
`verify_synthetic_augmentation.py`).

## Reproducing

```bash
python -m ml.scripts.prepare_dataset --csv /path/to/bicep_with_incomplete.csv
python -m ml.scripts.train
python -m ml.scripts.evaluate
python -m ml.scripts.predict --csv /path/to/bicep_with_incomplete.csv
```

To reproduce (or re-run) the synthetic augmentation experiment above without
touching the committed baseline:

```bash
python -m ml.scripts.prepare_dataset --csv /path/to/bicep_with_incomplete.csv \
    --tag synth_both --n-synthetic-extra 5 --synthetic-mode both
python -m ml.scripts.train --tag synth_both
python -m ml.scripts.verify_synthetic_augmentation --csv /path/to/bicep_with_incomplete.csv
```

## Structure

```
data/raw/            # place reduced.csv here (git-ignored, not committed)
data/processed/      # prepare_dataset.py outputs (features, splits, reports)
models/best_model/   # trained model + training_config.json + candidates/
results/             # confusion matrices, classification reports, curves
*_<tag>/              # --tag-scoped experiment output (e.g. best_model_synth_both/);
                      # gitignored and disposable, never the committed baseline
src/preprocessing/    # landmark schema + causal normalization (shared train/inference)
src/features/         # causal feature engineering (shared train/inference)
src/models/           # LSTM model/dataset + fixed label mapping
src/inference/        # BicepCurlPredictor -- live/streaming inference
scripts/              # prepare_dataset.py, train.py, evaluate.py, predict.py
```
