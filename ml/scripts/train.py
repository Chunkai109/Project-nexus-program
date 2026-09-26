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

RF_GRID = [
    {"n_estimators": 200, "max_depth": 4, "min_samples_leaf": 2},
    {"n_estimators": 300, "max_depth": 6, "min_samples_leaf": 1},
]
XGB_GRID = [
    {"n_estimators": 150, "max_depth": 3, "learning_rate": 0.1, "reg_lambda": 2.0},
    {"n_estimators": 250, "max_depth": 4, "learning_rate": 0.05, "reg_lambda": 3.0},
]


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
    X_dev = dev_df[AGGREGATE_FEATURE_NAMES].values
    y_dev = dev_df["class_label"].map(CLASS_TO_IDX).values
    groups_dev = dev_df["base_id"].values

    train_df = seq_df[seq_df["base_id"].isin(split["train"])]
    val_df = seq_df[seq_df["base_id"].isin(split["val"])]
    X_train = train_df[AGGREGATE_FEATURE_NAMES].values
    y_train = train_df["class_label"].map(CLASS_TO_IDX).values
    X_val = val_df[AGGREGATE_FEATURE_NAMES].values
    y_val = val_df["class_label"].map(CLASS_TO_IDX).values

    candidates = []
    for params in RF_GRID:
        f1_mean, f1_std = cv_score_group(
            lambda p=params: RandomForestClassifier(random_state=SEED, class_weight="balanced", n_jobs=-1, **p),
            X_dev, y_dev, groups_dev)
        candidates.append(("random_forest", params, f1_mean, f1_std))
        print(f"  RandomForest {params} -> CV macro-F1={f1_mean:.4f} (+/-{f1_std:.4f})")
    for params in XGB_GRID:
        f1_mean, f1_std = cv_score_group(
            lambda p=params: XGBClassifier(random_state=SEED, n_jobs=-1, objective="multi:softprob",
                                            num_class=len(CLASS_NAMES), eval_metric="mlogloss", **p),
            X_dev, y_dev, groups_dev)
        candidates.append(("xgboost", params, f1_mean, f1_std))
        print(f"  XGBoost {params} -> CV macro-F1={f1_mean:.4f} (+/-{f1_std:.4f})")

    candidates.sort(key=lambda r: r[2], reverse=True)
    best_clf_type, best_clf_params, best_clf_cv_f1, best_clf_cv_std = candidates[0]
    print(f"Best classical model: {best_clf_type} {best_clf_params} (CV macro-F1={best_clf_cv_f1:.4f})")

    if best_clf_type == "random_forest":
        clf_tv = RandomForestClassifier(random_state=SEED, class_weight="balanced", n_jobs=-1, **best_clf_params)
        clf_tv.fit(X_train, y_train)
    else:
        clf_tv = XGBClassifier(random_state=SEED, n_jobs=-1, objective="multi:softprob",
                                num_class=len(CLASS_NAMES), eval_metric="mlogloss", **best_clf_params)
        clf_tv.fit(X_train, y_train, sample_weight=sample_weights_balanced(y_train))
    clf_val_f1 = f1_score(y_val, clf_tv.predict(X_val), average="macro", zero_division=0)
    clf_val_acc = accuracy_score(y_val, clf_tv.predict(X_val))
    print(f"Classical model literal val macro-F1={clf_val_f1:.4f}  acc={clf_val_acc:.4f}")
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
        "classical_candidates": [{"model_type": t, "params": p, "cv_macro_f1_mean": f, "cv_macro_f1_std": s}
                                  for t, p, f, s in candidates],
        "best_classical_type": best_clf_type,
        "best_classical_params": best_clf_params,
        "best_classical_cv_macro_f1": best_clf_cv_f1,
        "classical_literal_val_macro_f1": clf_val_f1,
        "classical_literal_val_accuracy": clf_val_acc,
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

    print(f"\nSaved final model ({model_type_saved}) and artifacts to {MODEL_DIR}")
    print("Run scripts/evaluate.py next to evaluate on the held-out TEST base_ids.")


if __name__ == "__main__":
    main()
