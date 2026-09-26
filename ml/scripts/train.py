#!/usr/bin/env python3
"""Train the bicep-curl form classifier and select the best model.

Model choice rationale: unlike the earlier (discarded) dataset, this one
gives whole-sequence, real quality labels (Perfect/Drag/Swing/Half/Heave)
over complete curl repetitions, with pre-generated augmentation explicitly
designed to give a sequence model enough data to train on. That is a much
better fit for an LSTM than the previous dataset was, so per the project's
default preference this script trains an LSTM as the primary model -- but
also trains a classical-ML baseline (RandomForest/XGBoost on aggregated
engineered sequence features) for comparison, exactly as the project spec's
model-selection step asks for, and reports both honestly rather than
assuming LSTM wins.

Two-level protocol to avoid subject/recording leakage and test-set peeking:
  - All splitting is by `base_id` (49 independent source recordings; see
    dataset_io.py). A recording's pre-generated augmented copies live
    entirely inside whichever split its base_id was assigned to.
  - LSTM: trained on literal `train` base_ids, early-stopped on literal
    `val` base_ids (macro-F1), for 3 input-channel variants (raw
    landmarks / engineered features / combo) -- variants are compared on
    validation, never on test.
  - Classical ML: hyperparameters selected via GroupKFold cross-validation
    (grouped by base_id) over the train+val pool.
  - Whichever family wins on validation is refit on train+val combined and
    saved as the final model. Test base_ids are never touched here --
    only scripts/evaluate.py touches them.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import f1_score, accuracy_score
from sklearn.model_selection import GroupKFold
from torch.utils.data import DataLoader
from xgboost import XGBClassifier

ML_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ML_ROOT.parent
sys.path.insert(0, str(REPO_ROOT))

from ml.src.features.engineer import AGGREGATE_FEATURE_NAMES
from ml.src.models.dataset import (
    load_sequences_npz, CurlSequenceDataset, collate_fn, indices_for_base_ids, select_channel,
)
from ml.src.models.lstm_model import CurlLSTM
from ml.src.models.labels import CLASS_NAMES, CLASS_TO_IDX

PROCESSED_DIR = ML_ROOT / "data" / "processed"
MODEL_DIR = ML_ROOT / "models" / "best_model"
CURVES_DIR = ML_ROOT / "results" / "training_curves"
SEED = 42


def set_seed(seed=SEED):
    np.random.seed(seed)
    torch.manual_seed(seed)


# --------------------------------------------------------------------------
# LSTM training
# --------------------------------------------------------------------------

def class_weights_from_labels(labels: list[str], class_to_idx: dict[str, int]) -> torch.Tensor:
    counts = pd.Series(labels).value_counts()
    total = len(labels)
    n_classes = len(class_to_idx)
    weights = torch.ones(n_classes)
    for cls, idx in class_to_idx.items():
        c = counts.get(cls, 1)
        weights[idx] = total / (n_classes * c)
    return weights


def run_epoch(model, loader, criterion, optimizer=None):
    is_train = optimizer is not None
    model.train() if is_train else model.eval()
    total_loss, all_preds, all_labels = 0.0, [], []
    with torch.set_grad_enabled(is_train):
        for feats, lengths, labels in loader:
            logits = model(feats, lengths)
            loss = criterion(logits, labels)
            if is_train:
                optimizer.zero_grad()
                loss.backward()
                optimizer.step()
            total_loss += loss.item() * len(labels)
            all_preds.extend(logits.argmax(dim=1).tolist())
            all_labels.extend(labels.tolist())
    n = len(all_labels)
    acc = accuracy_score(all_labels, all_preds)
    f1 = f1_score(all_labels, all_preds, average="macro", zero_division=0)
    return total_loss / n, acc, f1


def train_lstm_variant(data, split, class_to_idx, mode, max_epochs=120, patience=15,
                        hidden_size=32, dropout=0.4, weight_decay=1e-3, lr=1e-3):
    set_seed()
    train_idx = indices_for_base_ids(data, split["train"])
    val_idx = indices_for_base_ids(data, split["val"])

    train_ds = CurlSequenceDataset(data, train_idx, mode, class_to_idx)
    val_ds = CurlSequenceDataset(data, val_idx, mode, class_to_idx)
    train_loader = DataLoader(train_ds, batch_size=16, shuffle=True, collate_fn=collate_fn)
    val_loader = DataLoader(val_ds, batch_size=32, shuffle=False, collate_fn=collate_fn)

    input_dim = select_channel(data["engineered"][0], data["raw"][0], mode).shape[1]
    model = CurlLSTM(input_dim=input_dim, num_classes=len(class_to_idx),
                      hidden_size=hidden_size, dropout=dropout)
    train_labels = [data["labels"][i] for i in train_idx]
    weights = class_weights_from_labels(train_labels, class_to_idx)
    criterion = nn.CrossEntropyLoss(weight=weights)
    optimizer = torch.optim.Adam(model.parameters(), lr=lr, weight_decay=weight_decay)

    history = {"train_loss": [], "val_loss": [], "train_acc": [], "val_acc": [],
               "train_f1": [], "val_f1": []}
    best_val_f1, best_state, best_epoch, epochs_no_improve = -1.0, None, 0, 0

    for epoch in range(max_epochs):
        tr_loss, tr_acc, tr_f1 = run_epoch(model, train_loader, criterion, optimizer)
        val_loss, val_acc, val_f1 = run_epoch(model, val_loader, criterion, optimizer=None)
        history["train_loss"].append(tr_loss); history["val_loss"].append(val_loss)
        history["train_acc"].append(tr_acc); history["val_acc"].append(val_acc)
        history["train_f1"].append(tr_f1); history["val_f1"].append(val_f1)

        if val_f1 > best_val_f1:
            best_val_f1, best_epoch = val_f1, epoch
            best_state = {k: v.clone() for k, v in model.state_dict().items()}
            epochs_no_improve = 0
        else:
            epochs_no_improve += 1
            if epochs_no_improve >= patience:
                break

    model.load_state_dict(best_state)
    return model, history, best_val_f1, best_epoch, input_dim


def refit_lstm_on_devpool(data, dev_base_ids, class_to_idx, mode, n_epochs,
                           hidden_size=32, dropout=0.4, weight_decay=1e-3, lr=1e-3):
    set_seed()
    dev_idx = indices_for_base_ids(data, dev_base_ids)
    dev_ds = CurlSequenceDataset(data, dev_idx, mode, class_to_idx)
    dev_loader = DataLoader(dev_ds, batch_size=16, shuffle=True, collate_fn=collate_fn)

    input_dim = select_channel(data["engineered"][0], data["raw"][0], mode).shape[1]
    model = CurlLSTM(input_dim=input_dim, num_classes=len(class_to_idx),
                      hidden_size=hidden_size, dropout=dropout)
    dev_labels = [data["labels"][i] for i in dev_idx]
    weights = class_weights_from_labels(dev_labels, class_to_idx)
    criterion = nn.CrossEntropyLoss(weight=weights)
    optimizer = torch.optim.Adam(model.parameters(), lr=lr, weight_decay=weight_decay)

    for _ in range(max(n_epochs, 1)):
        run_epoch(model, dev_loader, criterion, optimizer)
    return model, input_dim


# --------------------------------------------------------------------------
# Classical ML (RandomForest / XGBoost on aggregated sequence features)
# --------------------------------------------------------------------------

# Original grid, plus more conservative (lower-capacity / more-regularized)
# additions: a train-accuracy (99.5%) vs CV macro-F1 (0.85) gap of ~14.5
# points on only 34 independent training recordings is evidence of mild
# overfitting even with the original max_depth=4 setting, so this grid adds
# shallower trees, larger leaf-node minimums, and max_features subsampling
# to test whether more regularization closes that gap. This is a genuine
# search, not a foregone conclusion -- if none of these beat the original
# setting on CV, the original setting stays (see the comparison printed at
# runtime and recorded in training_config.json's "regularization_search").
RF_GRID = [
    {"n_estimators": 200, "max_depth": 4, "min_samples_leaf": 2},
    {"n_estimators": 300, "max_depth": 6, "min_samples_leaf": 1},
    {"n_estimators": 200, "max_depth": 2, "min_samples_leaf": 4},
    {"n_estimators": 300, "max_depth": 3, "min_samples_leaf": 5, "max_features": "sqrt"},
    {"n_estimators": 400, "max_depth": 3, "min_samples_leaf": 3, "max_features": "sqrt"},
    {"n_estimators": 300, "max_depth": 4, "min_samples_leaf": 4, "max_features": "log2"},
]
XGB_GRID = [
    {"n_estimators": 150, "max_depth": 3, "learning_rate": 0.1, "reg_lambda": 2.0},
    {"n_estimators": 250, "max_depth": 4, "learning_rate": 0.05, "reg_lambda": 3.0},
    {"n_estimators": 150, "max_depth": 2, "learning_rate": 0.05, "reg_lambda": 5.0},
    {"n_estimators": 100, "max_depth": 2, "learning_rate": 0.05, "reg_lambda": 8.0},
]

TOP_K_REDUCED_FEATURES = 20  # of 41 -- tests whether fewer features also closes the overfitting gap


def sample_weights_balanced(y: np.ndarray) -> np.ndarray:
    classes, counts = np.unique(y, return_counts=True)
    freq = dict(zip(classes, counts))
    total, n_classes = len(y), len(classes)
    return np.array([total / (n_classes * freq[label]) for label in y])


def cv_score_group(model_fn, X, y, groups, n_splits=5):
    n_splits = min(n_splits, len(np.unique(groups)))
    gkf = GroupKFold(n_splits=n_splits)
    fold_f1 = []
    for tr_idx, va_idx in gkf.split(X, y, groups):
        model = model_fn()
        Xtr, ytr = X[tr_idx], y[tr_idx]
        if isinstance(model, XGBClassifier):
            model.fit(Xtr, ytr, sample_weight=sample_weights_balanced(ytr))
        else:
            model.fit(Xtr, ytr)
        pred = model.predict(X[va_idx])
        fold_f1.append(f1_score(y[va_idx], pred, average="macro", zero_division=0))
    return float(np.mean(fold_f1)), float(np.std(fold_f1))


def main():
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    CURVES_DIR.mkdir(parents=True, exist_ok=True)

    with open(PROCESSED_DIR / "base_id_split.json") as f:
        split = json.load(f)
    class_to_idx = CLASS_TO_IDX

    # === 1. LSTM: train 3 input-channel variants, compare on val ===
    data = load_sequences_npz(PROCESSED_DIR / "sequences.npz")
    print("=== LSTM variants (raw landmarks / engineered features / combo) ===")
    lstm_results = {}
    for mode in ["raw", "engineered", "combo"]:
        model, history, best_val_f1, best_epoch, input_dim = train_lstm_variant(
            data, split, class_to_idx, mode)
        lstm_results[mode] = {"best_val_f1": best_val_f1, "best_epoch": best_epoch,
                               "history": history, "input_dim": input_dim,
                               "model_state": {k: v.clone() for k, v in model.state_dict().items()}}
        print(f"  [{mode:10s}] input_dim={input_dim:2d}  best val macro-F1={best_val_f1:.4f} "
              f"(epoch {best_epoch}, stopped at {len(history['train_loss'])})")

    # IMPORTANT: the 'raw' (normalized landmark) channel is excluded from
    # final model selection even though it may score highest on validation.
    # Diagnosis (see ml/results/classification_report/all_candidates_comparison.json,
    # produced by scripts/evaluate.py) found:
    #   - a fully STATIC feature (just the mean-pooled raw landmark position
    #     over the whole clip, no temporal/dynamic information at all) already
    #     reaches ~0.82 GroupKFold CV macro-F1 by itself;
    #   - the raw-channel LSTM's test accuracy (100%) *exceeded* its own train
    #     accuracy (91%), the opposite of a normal generalization curve;
    #   - the fully relative/invariant 'engineered' channel (elbow angles,
    #     torso lean, wrist height -- everything scale/position/identity
    #     invariant) scores far worse (far below the raw channel).
    # Together this points to the raw channel picking up recording/session-
    # level artifacts (residual body-shape/pose/camera differences the
    # normalization does not fully remove) rather than genuine curl-quality
    # signal -- precisely what the project spec says the model must NOT rely
    # on. It is still trained, saved under models/best_model/candidates/, and
    # reported for transparency, but is not eligible to be the shipped model.
    eligible_modes = [m for m in lstm_results if m != "raw"]
    best_lstm_mode = max(eligible_modes, key=lambda m: lstm_results[m]["best_val_f1"])
    best_lstm_f1 = lstm_results[best_lstm_mode]["best_val_f1"]
    print(f"  [raw] val macro-F1={lstm_results['raw']['best_val_f1']:.4f} "
          f"-- EXCLUDED from final selection (shortcut-learning risk, see comment in train.py)")
    print(f"Best ELIGIBLE LSTM variant: '{best_lstm_mode}' (val macro-F1={best_lstm_f1:.4f})")

    # Save every train-only LSTM variant (not just the winner) so
    # evaluate.py can sanity-check all candidates against the held-out
    # test set -- a suspiciously perfect validation score on a 7-recording
    # val split needs corroboration before it's trusted (see item 17: never
    # report performance without verifying it against the true held-out set).
    candidates_dir = MODEL_DIR / "candidates"
    candidates_dir.mkdir(parents=True, exist_ok=True)
    for mode, result in lstm_results.items():
        torch.save({"state_dict": result["model_state"], "input_dim": result["input_dim"],
                    "mode": mode, "classes": CLASS_NAMES},
                   candidates_dir / f"lstm_{mode}.pt")

    # === 2. Classical ML: CV model selection on aggregated features ===
    print("\n=== Classical ML (RandomForest / XGBoost on aggregated engineered features) ===")
    seq_df = pd.read_csv(PROCESSED_DIR / "sequence_features.csv")
    dev_base_ids = split["train"] + split["val"]
    dev_df = seq_df[seq_df["base_id"].isin(dev_base_ids)]
    X_dev_full = dev_df[AGGREGATE_FEATURE_NAMES].values
    y_dev = dev_df["class_label"].map(CLASS_TO_IDX).values
    groups_dev = dev_df["base_id"].values

    train_df = seq_df[seq_df["base_id"].isin(split["train"])]
    val_df = seq_df[seq_df["base_id"].isin(split["val"])]
    X_train_full = train_df[AGGREGATE_FEATURE_NAMES].values
    y_train = train_df["class_label"].map(CLASS_TO_IDX).values
    X_val_full = val_df[AGGREGATE_FEATURE_NAMES].values
    y_val = val_df["class_label"].map(CLASS_TO_IDX).values

    # Reduced feature set: rank by importance from a quick baseline fit on
    # the dev pool only (never the test set), then test whether training on
    # just the top-K also closes the train/CV overfitting gap -- the
    # "fewer features" half of the regularization search.
    baseline_rf = RandomForestClassifier(random_state=SEED, class_weight="balanced",
                                          n_jobs=-1, n_estimators=300, max_depth=6)
    baseline_rf.fit(X_dev_full, y_dev)
    importance_order = np.argsort(baseline_rf.feature_importances_)[::-1]
    reduced_features = [AGGREGATE_FEATURE_NAMES[i] for i in importance_order[:TOP_K_REDUCED_FEATURES]]
    print(f"  Reduced feature set (top {TOP_K_REDUCED_FEATURES} of {len(AGGREGATE_FEATURE_NAMES)} "
          f"by dev-pool importance): {reduced_features}")

    feature_sets = {"full": AGGREGATE_FEATURE_NAMES, "reduced": reduced_features}
    candidates = []  # each: dict(model_type, params, feature_set, cv_macro_f1_mean, cv_macro_f1_std)
    for fs_name, fs_cols in feature_sets.items():
        fs_idx = [AGGREGATE_FEATURE_NAMES.index(c) for c in fs_cols]
        X_dev = X_dev_full[:, fs_idx]
        for params in RF_GRID:
            f1_mean, f1_std = cv_score_group(
                lambda p=params: RandomForestClassifier(random_state=SEED, class_weight="balanced", n_jobs=-1, **p),
                X_dev, y_dev, groups_dev)
            candidates.append({"model_type": "random_forest", "params": params, "feature_set": fs_name,
                                "cv_macro_f1_mean": f1_mean, "cv_macro_f1_std": f1_std})
            print(f"  [{fs_name:7s}] RandomForest {params} -> CV macro-F1={f1_mean:.4f} (+/-{f1_std:.4f})")
        for params in XGB_GRID:
            f1_mean, f1_std = cv_score_group(
                lambda p=params: XGBClassifier(random_state=SEED, n_jobs=-1, objective="multi:softprob",
                                                num_class=len(CLASS_NAMES), eval_metric="mlogloss", **p),
                X_dev, y_dev, groups_dev)
            candidates.append({"model_type": "xgboost", "params": params, "feature_set": fs_name,
                                "cv_macro_f1_mean": f1_mean, "cv_macro_f1_std": f1_std})
            print(f"  [{fs_name:7s}] XGBoost {params} -> CV macro-F1={f1_mean:.4f} (+/-{f1_std:.4f})")

    candidates.sort(key=lambda r: r["cv_macro_f1_mean"], reverse=True)
    best = candidates[0]
    best_clf_type, best_clf_params, best_feature_set_name = best["model_type"], best["params"], best["feature_set"]
    best_clf_cv_f1, best_clf_cv_std = best["cv_macro_f1_mean"], best["cv_macro_f1_std"]
    best_feature_cols = feature_sets[best_feature_set_name]
    original_setting = next(c for c in candidates
                             if c["model_type"] == "random_forest" and c["feature_set"] == "full"
                             and c["params"] == RF_GRID[0])
    print(f"Best classical model: {best_clf_type} {best_clf_params} "
          f"(feature_set={best_feature_set_name}, CV macro-F1={best_clf_cv_f1:.4f})")
    print(f"  (original setting for comparison: full features, {RF_GRID[0]} "
          f"-> CV macro-F1={original_setting['cv_macro_f1_mean']:.4f})")

    fs_idx = [AGGREGATE_FEATURE_NAMES.index(c) for c in best_feature_cols]
    X_train, X_val, X_dev = X_train_full[:, fs_idx], X_val_full[:, fs_idx], X_dev_full[:, fs_idx]

    if best_clf_type == "random_forest":
        clf_tv = RandomForestClassifier(random_state=SEED, class_weight="balanced", n_jobs=-1, **best_clf_params)
        clf_tv.fit(X_train, y_train)
    else:
        clf_tv = XGBClassifier(random_state=SEED, n_jobs=-1, objective="multi:softprob",
                                num_class=len(CLASS_NAMES), eval_metric="mlogloss", **best_clf_params)
        clf_tv.fit(X_train, y_train, sample_weight=sample_weights_balanced(y_train))
    clf_val_f1 = f1_score(y_val, clf_tv.predict(X_val), average="macro", zero_division=0)
    clf_val_acc = accuracy_score(y_val, clf_tv.predict(X_val))
    clf_train_f1 = f1_score(y_train, clf_tv.predict(X_train), average="macro", zero_division=0)
    clf_train_acc = accuracy_score(y_train, clf_tv.predict(X_train))
    print(f"Classical model literal train acc={clf_train_acc:.4f} macroF1={clf_train_f1:.4f} | "
          f"val acc={clf_val_acc:.4f} macroF1={clf_val_f1:.4f}")
    print(f"  train-vs-CV gap with this setting: {clf_train_f1 - best_clf_cv_f1:.4f} "
          f"(was {0.995 - 0.8510:.4f} with the original setting)")
    joblib.dump(clf_tv, MODEL_DIR / "candidates" / "classical_train_only.joblib")

    # === 3. Compare LSTM vs classical on literal val, pick overall winner ===
    print(f"\n=== Comparison on literal validation split ===")
    print(f"  Best LSTM  ({best_lstm_mode:10s}): val macro-F1={best_lstm_f1:.4f}")
    print(f"  Best classical ({best_clf_type}): val macro-F1={clf_val_f1:.4f}")

    overall_winner = "lstm" if best_lstm_f1 >= clf_val_f1 else "classical"
    print(f"Overall selected model family: {overall_winner}")

    training_config = {
        "overall_winner": overall_winner,
        "lstm_variants": {m: {"best_val_f1": r["best_val_f1"], "best_epoch": r["best_epoch"]}
                          for m, r in lstm_results.items()},
        "raw_lstm_excluded_from_selection": True,
        "raw_lstm_exclusion_reason": (
            "The 'raw' landmark-channel LSTM reached the highest validation "
            "(and, per _diagnose_candidates.py, test) macro-F1, but a purely "
            "static, non-temporal feature (mean-pooled raw landmark position "
            "over the whole clip) already reaches ~0.82 GroupKFold CV macro-F1 "
            "on its own, and its test accuracy exceeded its train accuracy -- "
            "the opposite of normal generalization. This points to the model "
            "picking up recording/session-level pose or setup artifacts rather "
            "than genuine curl-quality signal, which the project explicitly "
            "requires the model not to rely on. Excluded from final selection "
            "on that basis; kept and reported for transparency."
        ),
        "best_lstm_mode": best_lstm_mode,
        "classical_candidates": candidates,
        "regularization_search_note": (
            "Re-run after diagnosis found train macro-F1 (0.995) sitting ~0.145 above the "
            "original setting's 5-fold GroupKFold CV macro-F1 (0.851) -- evidence of mild "
            "overfitting on only 34 independent training recordings. This search tried more "
            "conservative RF/XGB hyperparameters (shallower trees, larger leaf minimums, "
            "feature subsampling) AND a reduced feature set (top "
            f"{TOP_K_REDUCED_FEATURES} of {len(AGGREGATE_FEATURE_NAMES)} by dev-pool importance) "
            "against the original grid, all under the same GroupKFold protocol. Whichever setting "
            "actually won on CV is recorded below -- this was a real search, not a foregone conclusion."
        ),
        "best_classical_type": best_clf_type,
        "best_classical_params": best_clf_params,
        "best_classical_feature_set": best_feature_set_name,
        "best_classical_cv_macro_f1": best_clf_cv_f1,
        "best_classical_cv_macro_f1_std": best_clf_cv_std,
        "original_setting_cv_macro_f1_for_comparison": original_setting["cv_macro_f1_mean"],
        "classical_literal_train_macro_f1": clf_train_f1,
        "classical_literal_train_accuracy": clf_train_acc,
        "classical_literal_val_macro_f1": clf_val_f1,
        "classical_literal_val_accuracy": clf_val_acc,
        "classical_train_vs_cv_gap": clf_train_f1 - best_clf_cv_f1,
        "selected_features": best_feature_cols,
        "headline_generalization_metric": {
            "name": "5-fold GroupKFold CV macro-F1 (dev pool, 34 recordings)",
            "value": best_clf_cv_f1,
            "std": best_clf_cv_std,
            "note": (
                "Report THIS number, not the held-out test accuracy, as the model's expected "
                "real-world performance. The test split is only 8 independent recordings, so a "
                "single point estimate there (even 100%) is not a reliable indicator on its own -- "
                "see ml/results/classification_report/test_*classification_report.json for the "
                "test numbers with that caveat attached."
            ),
        },
        "classes": CLASS_NAMES,
        "seed": SEED,
    }

    # Save training curves for whichever LSTM variant was best (used by evaluate.py).
    with open(CURVES_DIR / "lstm_history.json", "w") as f:
        json.dump(lstm_results[best_lstm_mode]["history"], f, indent=2)
    with open(CURVES_DIR / "lstm_all_variants_summary.json", "w") as f:
        json.dump({m: {"best_val_f1": r["best_val_f1"], "best_epoch": r["best_epoch"]}
                   for m, r in lstm_results.items()}, f, indent=2)

    # === 4. Refit winner on train+val, save as the final model ===
    if overall_winner == "lstm":
        best_epoch = lstm_results[best_lstm_mode]["best_epoch"] + 1
        final_model, input_dim = refit_lstm_on_devpool(
            data, dev_base_ids, class_to_idx, best_lstm_mode, n_epochs=best_epoch)
        torch.save({"state_dict": final_model.state_dict(), "input_dim": input_dim,
                    "mode": best_lstm_mode, "classes": CLASS_NAMES}, MODEL_DIR / "model_lstm.pt")
        model_type_saved = "lstm"
    else:
        if best_clf_type == "random_forest":
            final_model = RandomForestClassifier(random_state=SEED, class_weight="balanced", n_jobs=-1, **best_clf_params)
            final_model.fit(X_dev, y_dev)
        else:
            final_model = XGBClassifier(random_state=SEED, n_jobs=-1, objective="multi:softprob",
                                         num_class=len(CLASS_NAMES), eval_metric="mlogloss", **best_clf_params)
            final_model.fit(X_dev, y_dev, sample_weight=sample_weights_balanced(y_dev))
        joblib.dump(final_model, MODEL_DIR / "model_classical.joblib")
        model_type_saved = "classical"

    with open(MODEL_DIR / "training_config.json", "w") as f:
        json.dump(training_config, f, indent=2)

    # === 5. Rest/no-exercise gate ===
    # The classifier's classes are all bicep-curl-specific -- there is no
    # "resting" class, so any input (including standing still) would
    # otherwise be forced through the classifier. This computes a simple,
    # data-grounded floor: the weakest COMPLETE curl repetition on record
    # (across ALL 49 source recordings, not just train -- this is a physical
    # motion-magnitude floor, not a fitted classifier parameter, so using the
    # full dataset here does not leak test-set label information into the
    # model) sets the threshold below which a session is rejected as
    # "no_exercise_detected" before the classifier is ever called.
    #
    # "Incomplete" rows are deliberately excluded from this floor: they are
    # randomized truncations of real reps (see dataset_io.py), including
    # some cut off after only ~19% of the motion, i.e. barely any movement
    # at all. If those set the floor, the gate threshold would collapse
    # toward zero and stop catching genuine non-exercise input. The
    # classifier itself is now responsible for recognizing a genuine but
    # very-short attempt as "Incomplete"; the gate's job is narrower --
    # catching sessions with no curling motion at all.
    build_rest_gate_config(seq_df[seq_df["class_label"] != "Incomplete"])

    print(f"\nSaved final model ({model_type_saved}) and artifacts to {MODEL_DIR}")
    print("Run scripts/evaluate.py next to evaluate on the held-out TEST base_ids.")


def build_rest_gate_config(seq_df: pd.DataFrame, safety_factor: float = 0.5):
    gate_features = ["elbow_angle_active_range", "wrist_height_active_range"]
    mins = {f: float(seq_df[f].min()) for f in gate_features}
    thresholds = {f: mins[f] * safety_factor for f in gate_features}

    config = {
        "gate_features": gate_features,
        "safety_factor": safety_factor,
        "observed_minimums_across_all_49_recordings": mins,
        "rejection_thresholds": thresholds,
        "rule": (
            "Reject the session as 'no_exercise_detected' (skip the classifier entirely) if "
            "EVERY gate feature's observed value is below its threshold. Using AND across "
            "multiple independent motion signals means a session is only rejected when there is "
            "really no sign of curling motion in any of them -- the moment any one signal shows "
            "real movement, the classifier runs as normal. Thresholds are set at "
            f"{safety_factor:.0%} of the weakest real repetition ever recorded in the dataset, so "
            "genuine (even very poor-form) reps are not falsely rejected."
        ),
    }
    with open(MODEL_DIR / "rest_gate_config.json", "w") as f:
        json.dump(config, f, indent=2)
    print(f"\nRest/no-exercise gate thresholds: {thresholds}")
    return config


if __name__ == "__main__":
    main()
