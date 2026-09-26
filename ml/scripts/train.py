#!/usr/bin/env python3
"""Train the bicep-curl rep-phase classifier.

Model choice rationale (see project report for the full writeup): with only
31 subjects total, a frame-sequence deep model (LSTM/GRU) trained end-to-end
would have very few independent subjects per split and a high risk of
memorizing subject-specific motion rather than learning the general curl
phase signal. Per the user's explicit decision, this script instead trains
classical models (RandomForest, XGBoost) on the engineered per-frame
features from src/features/engineer.py, which already encode short-window
temporal context (velocity, rolling std) without needing a large sample of
independent sequences to fit reliably.

Model selection protocol (no test-set peeking):
  1. Group the train+val subjects into a single "dev pool".
  2. For each candidate (model type x hyperparameter setting), run
     GroupKFold cross-validation *by subject* over the dev pool and score
     macro-F1. This is the reliable, subject-independent generalization
     estimate the project spec asks for (LOSO-style, practical at this
     dataset size with k=5 groups of subjects rather than 27 individual
     leave-one-out folds, which f1 already provides a low-variance-enough
     signal at 27 subjects while keeping runtime small).
  3. Also fit on the literal `train` subjects and evaluate on the literal
     `val` subjects, to report train/val separately as the spec requires.
  4. Refit the winning configuration on the full dev pool (train+val) and
     save it as the final model. The `test` subjects are never touched
     until scripts/evaluate.py runs.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import f1_score, accuracy_score
from sklearn.model_selection import GroupKFold
from sklearn.preprocessing import LabelEncoder
from xgboost import XGBClassifier

ML_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ML_ROOT.parent
sys.path.insert(0, str(REPO_ROOT))

from ml.src.features.engineer import FEATURE_NAMES

PROCESSED_DIR = ML_ROOT / "data" / "processed"
MODEL_DIR = ML_ROOT / "models" / "best_model"
CURVES_DIR = ML_ROOT / "results" / "training_curves"
SEED = 42


def load_data():
    df = pd.read_csv(PROCESSED_DIR / "bicep_curl_phases.csv")
    with open(PROCESSED_DIR / "subject_split.json") as f:
        split = json.load(f)
    return df, split


def xy(df: pd.DataFrame, subject_ids: list[str], encoder: LabelEncoder):
    sub_df = df[df["subject_id"].isin(subject_ids)]
    X = sub_df[FEATURE_NAMES].values
    y = encoder.transform(sub_df["label"].values)
    groups = sub_df["subject_id"].values
    return X, y, groups


RF_GRID = [
    {"n_estimators": 200, "max_depth": 6, "min_samples_leaf": 5},
    {"n_estimators": 300, "max_depth": 10, "min_samples_leaf": 3},
    {"n_estimators": 400, "max_depth": None, "min_samples_leaf": 1},
]
XGB_GRID = [
    {"n_estimators": 150, "max_depth": 3, "learning_rate": 0.1, "reg_lambda": 1.0},
    {"n_estimators": 300, "max_depth": 4, "learning_rate": 0.05, "reg_lambda": 2.0},
    {"n_estimators": 400, "max_depth": 5, "learning_rate": 0.03, "reg_lambda": 3.0},
]


def make_rf(params, class_weight="balanced"):
    return RandomForestClassifier(random_state=SEED, n_jobs=-1, class_weight=class_weight, **params)


def make_xgb(params, num_classes, sample_weight_eval=None):
    return XGBClassifier(random_state=SEED, n_jobs=-1, objective="multi:softprob",
                          num_class=num_classes, eval_metric="mlogloss", **params)


def sample_weights_balanced(y: np.ndarray) -> np.ndarray:
    classes, counts = np.unique(y, return_counts=True)
    freq = dict(zip(classes, counts))
    total = len(y)
    n_classes = len(classes)
    return np.array([total / (n_classes * freq[label]) for label in y])


def cv_score_group(model_fn, X, y, groups, n_splits=5):
    gkf = GroupKFold(n_splits=min(n_splits, len(np.unique(groups))))
    fold_f1 = []
    for train_idx, val_idx in gkf.split(X, y, groups):
        model = model_fn()
        Xtr, ytr = X[train_idx], y[train_idx]
        if isinstance(model, XGBClassifier):
            model.fit(Xtr, ytr, sample_weight=sample_weights_balanced(ytr))
        else:
            model.fit(Xtr, ytr)
        pred = model.predict(X[val_idx])
        fold_f1.append(f1_score(y[val_idx], pred, average="macro"))
    return float(np.mean(fold_f1)), float(np.std(fold_f1))


def main():
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    CURVES_DIR.mkdir(parents=True, exist_ok=True)

    df, split = load_data()
    encoder = LabelEncoder()
    encoder.fit(df["label"].values)
    num_classes = len(encoder.classes_)
    print(f"Classes: {list(encoder.classes_)}")

    dev_ids = split["train"] + split["val"]
    X_dev, y_dev, groups_dev = xy(df, dev_ids, encoder)
    X_train, y_train, _ = xy(df, split["train"], encoder)
    X_val, y_val, _ = xy(df, split["val"], encoder)
    X_test, y_test, _ = xy(df, split["test"], encoder)

    print(f"\nDev pool (train+val) for CV model selection: {len(dev_ids)} subjects, {len(X_dev)} frames")
    print(f"Literal train: {len(split['train'])} subjects, {len(X_train)} frames")
    print(f"Literal val:   {len(split['val'])} subjects, {len(X_val)} frames")
    print(f"Held-out test: {len(split['test'])} subjects, {len(X_test)} frames (untouched until evaluate.py)")

    results = []
    print("\n--- GroupKFold CV model selection (subject-independent, dev pool only) ---")
    for params in RF_GRID:
        mean_f1, std_f1 = cv_score_group(lambda p=params: make_rf(p), X_dev, y_dev, groups_dev)
        results.append(("random_forest", params, mean_f1, std_f1))
        print(f"RandomForest {params} -> CV macro-F1 = {mean_f1:.4f} (+/- {std_f1:.4f})")
    for params in XGB_GRID:
        mean_f1, std_f1 = cv_score_group(
            lambda p=params: make_xgb(p, num_classes), X_dev, y_dev, groups_dev)
        results.append(("xgboost", params, mean_f1, std_f1))
        print(f"XGBoost {params} -> CV macro-F1 = {mean_f1:.4f} (+/- {std_f1:.4f})")

    results.sort(key=lambda r: r[2], reverse=True)
    best_type, best_params, best_cv_f1, best_cv_std = results[0]
    print(f"\nSelected model: {best_type} {best_params} (CV macro-F1={best_cv_f1:.4f})")

    # --- Literal train -> val evaluation with the chosen config (for the
    # required separate train/val reporting) ---
    if best_type == "random_forest":
        model_tv = make_rf(best_params)
        model_tv.fit(X_train, y_train)
    else:
        model_tv = make_xgb(best_params, num_classes)
        model_tv.fit(X_train, y_train, sample_weight=sample_weights_balanced(y_train),
                     eval_set=[(X_train, y_train), (X_val, y_val)], verbose=False)
        evals_result = model_tv.evals_result()
        with open(CURVES_DIR / "xgboost_eval_history.json", "w") as f:
            json.dump(evals_result, f, indent=2)

    train_acc = accuracy_score(y_train, model_tv.predict(X_train))
    val_acc = accuracy_score(y_val, model_tv.predict(X_val))
    train_f1 = f1_score(y_train, model_tv.predict(X_train), average="macro")
    val_f1 = f1_score(y_val, model_tv.predict(X_val), average="macro")
    print(f"\n[train-only model] train acc={train_acc:.4f} macroF1={train_f1:.4f} | "
          f"val acc={val_acc:.4f} macroF1={val_f1:.4f}")

    if best_type == "random_forest":
        # RandomForest analogue of a "training curve": macro-F1 on train vs
        # val as a function of ensemble size, since RF has no per-epoch loss.
        curve_n = [10, 25, 50, 100, 150, 200, 300, 400]
        curve_train_f1, curve_val_f1 = [], []
        for n in curve_n:
            m = make_rf({**best_params, "n_estimators": n})
            m.fit(X_train, y_train)
            curve_train_f1.append(f1_score(y_train, m.predict(X_train), average="macro"))
            curve_val_f1.append(f1_score(y_val, m.predict(X_val), average="macro"))
        with open(CURVES_DIR / "rf_complexity_curve.json", "w") as f:
            json.dump({"n_estimators": curve_n, "train_macro_f1": curve_train_f1,
                       "val_macro_f1": curve_val_f1}, f, indent=2)

    # --- Refit on the full dev pool (train+val) with the chosen config: this is the saved model ---
    if best_type == "random_forest":
        final_model = make_rf(best_params)
        final_model.fit(X_dev, y_dev)
    else:
        final_model = make_xgb(best_params, num_classes)
        final_model.fit(X_dev, y_dev, sample_weight=sample_weights_balanced(y_dev))

    dev_acc = accuracy_score(y_dev, final_model.predict(X_dev))
    dev_f1 = f1_score(y_dev, final_model.predict(X_dev), average="macro")
    print(f"[final model, refit on train+val] dev-pool acc={dev_acc:.4f} macroF1={dev_f1:.4f}")

    joblib.dump(final_model, MODEL_DIR / "model.joblib")
    joblib.dump(encoder, MODEL_DIR / "label_encoder.joblib")
    with open(MODEL_DIR / "feature_config.json", "w") as f:
        json.dump({"feature_names": FEATURE_NAMES}, f, indent=2)
    with open(MODEL_DIR / "training_config.json", "w") as f:
        json.dump({
            "model_type": best_type,
            "hyperparameters": best_params,
            "cv_macro_f1_mean": best_cv_f1,
            "cv_macro_f1_std": best_cv_std,
            "train_only_metrics": {"accuracy": train_acc, "macro_f1": train_f1},
            "val_only_metrics": {"accuracy": val_acc, "macro_f1": val_f1},
            "dev_pool_refit_metrics": {"accuracy": dev_acc, "macro_f1": dev_f1},
            "classes": list(encoder.classes_),
            "seed": SEED,
            "all_candidate_results": [
                {"model_type": t, "params": p, "cv_macro_f1_mean": f, "cv_macro_f1_std": s}
                for t, p, f, s in results
            ],
        }, f, indent=2)

    print(f"\nSaved model + artifacts to {MODEL_DIR}")
    print("Run scripts/evaluate.py next to evaluate on the held-out TEST subjects.")


if __name__ == "__main__":
    main()
