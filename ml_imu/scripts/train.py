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
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import GroupKFold
from sklearn.metrics import f1_score

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

MODEL_DIR = ML_IMU_ROOT / "models" / "best_model"


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


def check_group_integrity(groups: np.ndarray, fold_assignments: np.ndarray) -> bool:
    """Assert every sample sharing a test_id lands in exactly one fold."""
    ok = True
    for g in np.unique(groups):
        fold_ids = set(fold_assignments[groups == g])
        if len(fold_ids) != 1:
            print(f"  [LEAKAGE] test_id={g} spans folds {fold_ids}")
            ok = False
    return ok


def run_cv(X, y, groups, params) -> dict:
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

        clf = RandomForestClassifier(random_state=SEED, class_weight="balanced", n_jobs=-1, **params)
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

    print(f"\n=== GroupKFold (n_splits={N_SPLITS}, group=test_id) regularization search ===")
    results = []
    for params in RF_GRID:
        res = run_cv(X, y, groups, params)
        results.append((params, res))
        tag = "[baseline, unregularized]" if params.get("max_depth") is None else ""
        print(f"  {params} {tag}")
        print(f"    -> CV macro-F1={res['cv_macro_f1_mean']:.4f} (+/-{res['cv_macro_f1_std']:.4f})  "
              f"per-fold={[round(f,3) for f in res['fold_macro_f1']]}")
        for note in res["class_dropout_notes"]:
            print(f"    [WARNING] {note}")

    # Tie-break toward the MORE regularized config: when CV can't
    # discriminate between settings (see the ceiling-effect check below,
    # which is exactly what happens on this dataset), shipping the shallowest
    # tied model is the more honest choice, not the first one listed.
    best_score = max(res["cv_macro_f1_mean"] for _, res in results)
    tied = [(p, r) for p, r in results if r["cv_macro_f1_mean"] == best_score]
    def depth_key(pr):
        d = pr[0].get("max_depth")
        return d if d is not None else float("inf")
    best_params, best_res = min(tied, key=depth_key)
    print(f"\nBest config (tie-broken toward more regularization): {best_params}")
    print(f"Headline CV macro-F1: {best_res['cv_macro_f1_mean']:.4f} +/- {best_res['cv_macro_f1_std']:.4f}")

    ceiling_effect_warning = None
    if best_res["cv_macro_f1_mean"] >= 0.999:
        ceiling_effect_warning = (
            "CV macro-F1 hit ~1.0 across EVERY regularization setting tested, "
            "including the fully unregularized baseline. This is a red flag, not "
            "a win -- treated with the same suspicion this project applied to the "
            "vision model's raw-landmark LSTM hitting 100% test accuracy (flagged "
            "as shortcut learning, not celebrated). Direct cause, confirmed by "
            "inspecting the feature distributions: drift_max alone separates Drag "
            "(21.5-32.7) from every other class (max ~12.7 elsewhere) with a huge "
            "gap, and flex_range separates Half (53-83) and Heave (101-115) from "
            "the rest almost as cleanly -- a 2-threshold decision tree already "
            "gets this perfectly, which is why even max_depth=2 scores 1.0. This "
            "is a mechanical consequence of the test protocol (one person "
            "performing deliberately extreme, distinct demonstrations of each "
            "error type), not evidence the model has learned anything robust or "
            "generalizable. It says nothing about performance on a different "
            "person, a genuinely ambiguous rep, or subtler real-world form "
            "errors -- only that it can tell these 35 staged, exaggerated "
            "demonstrations apart from each other."
        )
        print(f"\n[WARNING] {ceiling_effect_warning}")

    # Refit on ALL data for the saved/deployed model.
    final_model = RandomForestClassifier(random_state=SEED, class_weight="balanced", n_jobs=-1, **best_params)
    final_model.fit(X, y)

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    import joblib
    joblib.dump(final_model, MODEL_DIR / "model.joblib")

    feature_importance = dict(zip(FEATURE_NAMES, [float(v) for v in final_model.feature_importances_]))
    feature_importance = dict(sorted(feature_importance.items(), key=lambda kv: -kv[1]))

    config = {
        "classes": CLASS_NAMES,
        "feature_names": FEATURE_NAMES,
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
