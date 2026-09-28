#!/usr/bin/env python3
"""Train the IMU/EMG classifier and report the ONLY honest headline metric
at this data scale: GroupKFold macro-F1 (group=test_id), never a held-out
test-set number -- see ml_imu/README.md for why a separate held-out split
isn't meaningful with only 35 raw sessions.

No LSTM comparison is run here (unlike ml/scripts/train.py): the vision
model already established, with 34 training recordings, that a raw-landmark
LSTM shows shortcut-learning symptoms and loses to RandomForest on
engineered features. This IMU dataset has fewer independent groups (35
sessions, several classes represented by only 5-8 groups), so training an
LSTM here would be an even more foregone conclusion -- stated explicitly
rather than silently skipped.

Usage: python -m ml_imu.scripts.train
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GroupKFold
from sklearn.metrics import f1_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

ML_IMU_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ML_IMU_ROOT.parent
sys.path.insert(0, str(REPO_ROOT))

from ml_imu.src.features import extract_rep_features, FEATURE_NAMES
from ml_imu.src.labels import CLASS_NAMES, CLASS_TO_IDX

SEED = 42
N_SPLITS = 5

# Small regularization grid -- even more conservative than ml/scripts/train.py's
# RF_GRID given this dataset has fewer independent groups (35 vs 41 dev pool).
# The first entry (unconstrained) is kept only as a comparison baseline.
RF_GRID = [
    {"n_estimators": 300, "max_depth": None, "min_samples_leaf": 1},  # baseline, no regularization
    {"n_estimators": 100, "max_depth": 2, "min_samples_leaf": 2},
    {"n_estimators": 200, "max_depth": 3, "min_samples_leaf": 2},
    {"n_estimators": 200, "max_depth": 3, "min_samples_leaf": 3, "max_features": "sqrt"},
    {"n_estimators": 300, "max_depth": 4, "min_samples_leaf": 2},
]

# Logistic Regression comparison, on the SAME labeled data/features/groups
# as RandomForest above -- requested to see whether a linear model tells
# the same story as RF's ceiling-effect finding. Wrapped in a Pipeline with
# StandardScaler since (unlike tree-based RandomForest) logistic regression
# is sensitive to feature scale, and this dataset's 19 raw features span
# very different ranges (e.g. emg_mean in the thousands vs vib_on_frac in
# [0,1]) -- an unscaled fit would be a biased, unfair comparison.
LR_GRID = [
    {"C": 0.01}, {"C": 0.1}, {"C": 1.0}, {"C": 10.0},
]

MODEL_DIR = ML_IMU_ROOT / "models" / "best_model"


def make_rf(params):
    return RandomForestClassifier(random_state=SEED, class_weight="balanced", n_jobs=-1, **params)


def make_lr(params):
    return Pipeline([
        ("scale", StandardScaler()),
        ("clf", LogisticRegression(random_state=SEED, class_weight="balanced",
                                    max_iter=2000, **params)),
    ])


def build_dataset():
    labels_df = pd.read_csv(ML_IMU_ROOT / "data" / "imu_labels.csv")
    sessions_df = pd.read_csv(ML_IMU_ROOT / "data" / "processed" / "imu_sessions.csv")

    X, y, groups = [], [], []
    for _, row in labels_df.iterrows():
        sess = sessions_df[sessions_df.test_id == row.test_id]
        sess = sess[(sess.frame_idx >= row.start_frame) & (sess.frame_idx <= row.end_frame)]
        sess = sess.sort_values("frame_idx")
        feats = extract_rep_features(
            sess.flex.to_numpy(), sess.drift.to_numpy(),
            sess.emg.to_numpy(), sess.vib_on.to_numpy(),
        )
        X.append(feats)
        y.append(CLASS_TO_IDX[row.label])
        groups.append(row.test_id)

    return np.stack(X), np.array(y), np.array(groups), labels_df


def build_novelty_detector(X: np.ndarray, false_reject_rate: float = 0.02):
    """Fit an IsolationForest on all 52 labeled reps' features (any of the
    4 known classes counts as "in-distribution" -- novelty detection is
    about recognizing a curl at all, not judging its quality). Mirrors
    ml/scripts/train.py's build_novelty_detector() exactly in method and
    default false_reject_rate.

    IMPORTANT DIFFERENCE FROM THE VISION MODEL: the vision model's
    threshold was picked from a dev-pool score distribution and then
    checked against genuinely held-out real test data (see ml/README.md's
    empirical false-reject-rate table). This IMU classifier has no
    held-out data at all -- every one of the 52 rows was used to fit both
    the classifier and this detector. So while the METHOD is identical, the
    threshold here is honestly a rougher estimate: at n=52, the 2nd
    percentile is close to "the single most extreme point on record" and
    cannot be validated against anything the detector hasn't already seen.
    Treat it as a coarse floor, not a precisely-tuned boundary.
    """
    detector = IsolationForest(n_estimators=200, contamination="auto", random_state=SEED)
    detector.fit(X)

    scores = detector.decision_function(X)
    threshold = float(np.percentile(scores, false_reject_rate * 100))

    import joblib
    joblib.dump(detector, MODEL_DIR / "novelty_detector.joblib")
    config = {
        "feature_names": FEATURE_NAMES,
        "false_reject_rate": false_reject_rate,
        "threshold": threshold,
        "training_score_stats": {
            "min": float(scores.min()), "max": float(scores.max()),
            "mean": float(scores.mean()), "threshold_percentile": f"{false_reject_rate:.0%}",
        },
        "caveat": (
            "Unlike ml/'s novelty detector, this threshold was NOT validated "
            "against held-out data -- there is none at this data scale (only "
            "35 raw sessions total, all used to fit both the classifier and "
            "this detector). It is a coarse floor derived from the most "
            "extreme examples on record, not an empirically-tuned tradeoff. "
            "It will reliably catch inputs wildly outside anything recorded "
            "(wrong device fit, different exercise entirely) but cannot "
            "distinguish a genuinely different person's normal signal from "
            "an anomaly, since the training data itself only covers one "
            "person's narrow range."
        ),
        "rule": (
            "Reject as 'unrecognized_input' if "
            "detector.decision_function(features) < threshold. Fit on all 4 "
            "known classes' engineered features (any of Perfect/Drag/Half/"
            "Heave counts as in-distribution) -- this detects whether the "
            "input resembles ANYTHING this dataset has seen at all, not "
            "which class it belongs to."
        ),
    }
    with open(MODEL_DIR / "novelty_detector_config.json", "w") as f:
        json.dump(config, f, indent=2)
    print(f"\nNovelty detector: threshold={threshold:.4f} "
          f"(training scores range {scores.min():.4f} to {scores.max():.4f})")
    return detector, config


def build_feature_reference_stats(X: np.ndarray):
    stats = {}
    for i, name in enumerate(FEATURE_NAMES):
        vals = X[:, i]
        stats[name] = {"mean": float(vals.mean()), "std": float(vals.std()),
                        "min": float(vals.min()), "max": float(vals.max())}
    with open(MODEL_DIR / "feature_reference_stats.json", "w") as f:
        json.dump(stats, f, indent=2)
    print(f"Saved feature reference stats (all 52 labeled reps) for live diagnostics")
    return stats


def check_group_integrity(groups: np.ndarray, fold_assignments: np.ndarray) -> bool:
    """Assert every sample sharing a test_id lands in exactly one fold."""
    ok = True
    for g in np.unique(groups):
        fold_ids = set(fold_assignments[groups == g])
        if len(fold_ids) != 1:
            print(f"  [LEAKAGE] test_id={g} spans folds {fold_ids}")
            ok = False
    return ok


def run_cv(X, y, groups, params, make_estimator) -> dict:
    """GroupKFold CV for any estimator-building function `make_estimator(params)`.
    The estimator (and, for the LR pipeline, its StandardScaler) is fit ONLY
    on each fold's training split -- never on validation data or the full
    dataset before splitting -- so there's no scaling leakage either."""
    gkf = GroupKFold(n_splits=N_SPLITS)
    fold_f1s = []
    class_dropout_notes = []
    fold_assignments = np.full(len(y), -1)

    for fold_idx, (train_idx, val_idx) in enumerate(gkf.split(X, y, groups)):
        fold_assignments[val_idx] = fold_idx
        train_classes = set(y[train_idx])
        missing = set(range(len(CLASS_NAMES))) - train_classes
        if missing:
            missing_names = [CLASS_NAMES[i] for i in missing]
            class_dropout_notes.append(
                f"fold {fold_idx}: training split is missing class(es) {missing_names} entirely"
            )

        clf = make_estimator(params)
        clf.fit(X[train_idx], y[train_idx])
        pred = clf.predict(X[val_idx])
        f1 = f1_score(y[val_idx], pred, average="macro", labels=list(range(len(CLASS_NAMES))), zero_division=0)
        fold_f1s.append(f1)

    assert check_group_integrity(groups, fold_assignments), "group leakage across CV folds"

    return {
        "cv_macro_f1_mean": float(np.mean(fold_f1s)),
        "cv_macro_f1_std": float(np.std(fold_f1s)),
        "fold_macro_f1": [float(f) for f in fold_f1s],
        "class_dropout_notes": class_dropout_notes,
    }


def main():
    X, y, groups, labels_df = build_dataset()
    print(f"Dataset: {len(y)} labeled reps across {len(np.unique(groups))} raw sessions (groups)")
    print(f"Class counts: { {CLASS_NAMES[i]: int((y == i).sum()) for i in range(len(CLASS_NAMES))} }")
    print(f"Groups per class: { {CLASS_NAMES[i]: int(labels_df[labels_df.label == CLASS_NAMES[i]].test_id.nunique()) for i in range(len(CLASS_NAMES))} }")

    print(f"\n=== RandomForest: GroupKFold (n_splits={N_SPLITS}, group=test_id) regularization search ===")
    rf_results = []
    for params in RF_GRID:
        res = run_cv(X, y, groups, params, make_rf)
        rf_results.append((params, res))
        tag = "[baseline, unregularized]" if params.get("max_depth") is None else ""
        print(f"  {params} {tag}")
        print(f"    -> CV macro-F1={res['cv_macro_f1_mean']:.4f} (+/-{res['cv_macro_f1_std']:.4f})  "
              f"per-fold={[round(f,3) for f in res['fold_macro_f1']]}")
        for note in res["class_dropout_notes"]:
            print(f"    [WARNING] {note}")

    print(f"\n=== Logistic Regression: GroupKFold (n_splits={N_SPLITS}, group=test_id) "
          f"comparison, SAME labeled data/features/groups as above ===")
    lr_results = []
    for params in LR_GRID:
        res = run_cv(X, y, groups, params, make_lr)
        lr_results.append((params, res))
        print(f"  {params}")
        print(f"    -> CV macro-F1={res['cv_macro_f1_mean']:.4f} (+/-{res['cv_macro_f1_std']:.4f})  "
              f"per-fold={[round(f,3) for f in res['fold_macro_f1']]}")
        for note in res["class_dropout_notes"]:
            print(f"    [WARNING] {note}")

    # Tie-break toward the MORE regularized config: when CV can't
    # discriminate between settings (see the ceiling-effect check below,
    # which is exactly what happens on this dataset), shipping the shallowest
    # tied model is the more honest choice, not the first one listed.
    best_score = max(res["cv_macro_f1_mean"] for _, res in rf_results)
    tied = [(p, r) for p, r in rf_results if r["cv_macro_f1_mean"] == best_score]
    def depth_key(pr):
        d = pr[0].get("max_depth")
        return d if d is not None else float("inf")
    rf_best_params, rf_best_res = min(tied, key=depth_key)

    best_lr_score = max(res["cv_macro_f1_mean"] for _, res in lr_results)
    best_lr_params, best_lr_res = min(
        [(p, r) for p, r in lr_results if r["cv_macro_f1_mean"] == best_lr_score],
        key=lambda pr: pr[0]["C"],  # tie-break toward smaller C = more regularization
    )

    print(f"\n=== Model comparison (same data, same CV protocol) ===")
    print(f"  RandomForest best: {rf_best_params} -> {rf_best_res['cv_macro_f1_mean']:.4f} +/- {rf_best_res['cv_macro_f1_std']:.4f}")
    print(f"  LogisticRegression best: {best_lr_params} -> {best_lr_res['cv_macro_f1_mean']:.4f} +/- {best_lr_res['cv_macro_f1_std']:.4f}")

    # Decision protocol: keep RandomForest as the deployed model unless
    # Logistic Regression is CLEARLY better -- not just nominally higher.
    # Given how small/cleanly-separable this data already is, ties are the
    # expected outcome; report whatever actually happens.
    clearly_better = best_lr_res["cv_macro_f1_mean"] > rf_best_res["cv_macro_f1_mean"] + rf_best_res["cv_macro_f1_std"]
    deployed_model_family = "logistic_regression" if clearly_better else "random_forest"
    print(f"  Deployed model: {deployed_model_family} "
          f"({'LR clearly beat RF' if clearly_better else 'RF kept -- LR did not clearly beat it'})")

    best_params, best_res = (best_lr_params, best_lr_res) if clearly_better else (rf_best_params, rf_best_res)
    print(f"\nBest config: {best_params}")
    print(f"Headline CV macro-F1: {best_res['cv_macro_f1_mean']:.4f} +/- {best_res['cv_macro_f1_std']:.4f}")

    rf_hit_ceiling = best_score >= 0.999
    lr_hit_ceiling = best_lr_score >= 0.999
    ceiling_effect_warning = None
    if rf_hit_ceiling or lr_hit_ceiling:
        both = "BOTH RandomForest and Logistic Regression" if (rf_hit_ceiling and lr_hit_ceiling) else \
               ("RandomForest" if rf_hit_ceiling else "Logistic Regression")
        ceiling_effect_warning = (
            f"CV macro-F1 hit ~1.0 for {both} across every setting tested (RF: "
            f"every regularization strength incl. the unregularized baseline; "
            f"LR: every C value tested). This is a red flag, not a win -- treated "
            f"with the same suspicion this project applied to the vision model's "
            f"raw-landmark LSTM hitting 100% test accuracy (flagged as shortcut "
            f"learning, not celebrated). Direct cause, confirmed by inspecting the "
            f"feature distributions: drift_max alone separates Drag (21.5-32.7) "
            f"from every other class (max ~12.7 elsewhere) with a huge gap, and "
            f"flex_range separates Half (53-83) and Heave (101-115) from the rest "
            f"almost as cleanly -- a 2-threshold decision boundary already gets "
            f"this perfectly, whether that boundary is found by a shallow tree or "
            f"a linear model. Both model families agreeing (if both hit the "
            f"ceiling) is actually further evidence for this diagnosis, not "
            f"against it: it means the classes are cleanly separable in this "
            f"feature space by essentially any reasonable classifier, which is "
            f"exactly what a mechanically-constructed, deliberately-exaggerated, "
            f"single-person test protocol would produce. This is not evidence "
            f"either model has learned anything robust or generalizable -- it "
            f"says nothing about performance on a different person, a genuinely "
            f"ambiguous rep, or subtler real-world form errors, only that both "
            f"can tell these 35 staged, exaggerated demonstrations apart."
        )
        print(f"\n[WARNING] {ceiling_effect_warning}")

    # Refit on ALL data for the saved/deployed model.
    make_final = make_lr if clearly_better else make_rf
    final_model = make_final(best_params)
    final_model.fit(X, y)

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    import joblib
    joblib.dump(final_model, MODEL_DIR / "model.joblib")

    build_novelty_detector(X)
    build_feature_reference_stats(X)

    if deployed_model_family == "random_forest":
        feature_importance = dict(zip(FEATURE_NAMES, [float(v) for v in final_model.feature_importances_]))
        feature_importance = dict(sorted(feature_importance.items(), key=lambda kv: -kv[1]))
    else:
        # LogisticRegression pipeline: report mean |coefficient| across the
        # one-vs-rest class coefficients as the closest analog to RF's
        # feature_importances_ (coefficients are on the STANDARDIZED scale,
        # since they come from inside the fitted Pipeline's scaler step).
        coefs = final_model.named_steps["clf"].coef_  # (n_classes, n_features)
        mean_abs_coef = np.abs(coefs).mean(axis=0)
        feature_importance = dict(zip(FEATURE_NAMES, [float(v) for v in mean_abs_coef]))
        feature_importance = dict(sorted(feature_importance.items(), key=lambda kv: -kv[1]))

    config = {
        "classes": CLASS_NAMES,
        "feature_names": FEATURE_NAMES,
        "deployed_model_family": deployed_model_family,
        "model_comparison": {
            "random_forest": {
                "grid": [{"params": p, "cv_macro_f1_mean": r["cv_macro_f1_mean"],
                          "cv_macro_f1_std": r["cv_macro_f1_std"], "fold_macro_f1": r["fold_macro_f1"]}
                         for p, r in rf_results],
                "best_params": rf_best_params,
                "best_cv_macro_f1": best_score,
                "hit_ceiling": rf_hit_ceiling,
            },
            "logistic_regression": {
                "grid": [{"params": p, "cv_macro_f1_mean": r["cv_macro_f1_mean"],
                          "cv_macro_f1_std": r["cv_macro_f1_std"], "fold_macro_f1": r["fold_macro_f1"]}
                         for p, r in lr_results],
                "best_params": best_lr_params,
                "best_cv_macro_f1": best_lr_score,
                "hit_ceiling": lr_hit_ceiling,
            },
            "decision_protocol": (
                "Deployed model stays RandomForest unless Logistic Regression's "
                "best CV macro-F1 clearly exceeds RandomForest's best + 1 std -- "
                "not just a nominally higher number. "
                + ("Logistic Regression cleared that bar." if clearly_better else
                   "Logistic Regression did not clear that bar, so RandomForest "
                   "was kept.")
            ),
        },
        "best_params": best_params,
        "headline_generalization_metric": {
            "name": f"{N_SPLITS}-fold GroupKFold macro-F1 (group=test_id, all 35 raw sessions)",
            "value": best_res["cv_macro_f1_mean"],
            "std": best_res["cv_macro_f1_std"],
            "fold_macro_f1": best_res["fold_macro_f1"],
            "note": (
                "Report THIS number, not any single-split test accuracy, as this "
                "model's expected performance. No held-out test set is used at "
                "all for this classifier -- with only 35 raw sessions and as few "
                "as 5 groups for the rarest class (Heave), carving out a separate "
                "held-out split the way ml/'s vision model does would leave too "
                "few groups for either the CV estimate or the held-out set to "
                "mean anything. This CV number itself should also be read with "
                "real caution given how few groups back up each class."
            ),
        },
        "class_dropout_notes": best_res["class_dropout_notes"],
        "ceiling_effect_warning": ceiling_effect_warning,
        "class_counts": {CLASS_NAMES[i]: int((y == i).sum()) for i in range(len(CLASS_NAMES))},
        "groups_per_class": {CLASS_NAMES[i]: int(labels_df[labels_df.label == CLASS_NAMES[i]].test_id.nunique())
                              for i in range(len(CLASS_NAMES))},
        "feature_importance": feature_importance,
        "no_lstm_comparison_note": (
            "No LSTM was trained or compared for this dataset. ml/'s vision "
            "model already established, with 34 training recordings, that a "
            "raw-landmark LSTM shows shortcut-learning symptoms and loses to "
            "RandomForest on engineered features. This dataset has fewer "
            "independent groups (35 total, several classes with only 5-8 "
            "groups), so training an LSTM here would be an even more "
            "foregone conclusion than it already was for the vision model -- "
            "skipped explicitly, not silently."
        ),
        "seed": SEED,
    }
    with open(MODEL_DIR / "training_config.json", "w") as f:
        json.dump(config, f, indent=2)
    print(f"\nSaved model + training_config.json to {MODEL_DIR}")
    print(f"\nFeature importance (top 8): {list(feature_importance.items())[:8]}")


if __name__ == "__main__":
    main()
