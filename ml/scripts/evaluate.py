#!/usr/bin/env python3
"""Full evaluation of the final saved model on TRAIN, VAL, and the held-out
TEST base_ids (source recordings never touched during model selection).

Also evaluates every trained candidate (all 3 LSTM input channels + the
classical baseline) on the same three splits and saves that comparison
table -- this is what caught the raw-landmark LSTM's shortcut-learning
problem during development (see train.py's exclusion comment) and is kept
here so the finding stays reproducible and visible rather than living only
in a throwaway script.

Because val/test are only 7/8 independent source recordings, per-class
support at the recording level is very thin (as low as 1). Metrics are
reported at two granularities for the final model: over ALL video_id rows
(original + augmented copies) in a split, which gives more stable numbers
but with correlated near-duplicates, and over ORIGINAL-only rows, the
cleanest (if noisier) independent-sample estimate.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import joblib
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import torch
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score
from torch.utils.data import DataLoader

ML_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ML_ROOT.parent
sys.path.insert(0, str(REPO_ROOT))

from ml.src.features.engineer import AGGREGATE_FEATURE_NAMES
from ml.src.models.dataset import load_sequences_npz, CurlSequenceDataset, collate_fn, indices_for_base_ids
from ml.src.models.lstm_model import CurlLSTM
from ml.src.models.labels import CLASS_NAMES, CLASS_TO_IDX

PROCESSED_DIR = ML_ROOT / "data" / "processed"
MODEL_DIR = ML_ROOT / "models" / "best_model"
RESULTS_DIR = ML_ROOT / "results"
CM_DIR = RESULTS_DIR / "confusion_matrix"
REPORT_DIR = RESULTS_DIR / "classification_report"
CURVES_DIR = RESULTS_DIR / "training_curves"


def plot_confusion_matrix(cm, class_names, title, out_path):
    fig, ax = plt.subplots(figsize=(6, 5))
    im = ax.imshow(cm, cmap="Blues")
    ax.set_xticks(range(len(class_names))); ax.set_yticks(range(len(class_names)))
    ax.set_xticklabels(class_names, rotation=45, ha="right")
    ax.set_yticklabels(class_names)
    ax.set_xlabel("Predicted"); ax.set_ylabel("Actual"); ax.set_title(title)
    thresh = cm.max() / 2.0 if cm.max() > 0 else 1
    for i in range(cm.shape[0]):
        for j in range(cm.shape[1]):
            ax.text(j, i, str(cm[i, j]), ha="center", va="center",
                     color="white" if cm[i, j] > thresh else "black")
    fig.colorbar(im, ax=ax)
    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    plt.close(fig)


def evaluate_predictions(name, y_true, y_pred, save=True):
    acc = accuracy_score(y_true, y_pred)
    macro_f1 = f1_score(y_true, y_pred, average="macro", zero_division=0)
    weighted_f1 = f1_score(y_true, y_pred, average="weighted", zero_division=0)
    report = classification_report(y_true, y_pred, labels=list(range(len(CLASS_NAMES))),
                                    target_names=CLASS_NAMES, output_dict=True, zero_division=0)
    cm = confusion_matrix(y_true, y_pred, labels=list(range(len(CLASS_NAMES))))

    print(f"\n=== {name} ===")
    print(f"Accuracy: {acc:.4f}  |  Classification error: {1 - acc:.4f}")
    print(f"Macro F1: {macro_f1:.4f}  |  Weighted F1: {weighted_f1:.4f}")
    print(classification_report(y_true, y_pred, labels=list(range(len(CLASS_NAMES))),
                                 target_names=CLASS_NAMES, zero_division=0))

    if save:
        safe_name = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
        plot_confusion_matrix(cm, CLASS_NAMES, f"{name} confusion matrix",
                               CM_DIR / f"{safe_name}_confusion_matrix.png")
        with open(REPORT_DIR / f"{safe_name}_classification_report.json", "w") as f:
            json.dump({"accuracy": acc, "classification_error": 1 - acc,
                       "macro_f1": macro_f1, "weighted_f1": weighted_f1,
                       "per_class": report, "confusion_matrix": cm.tolist(),
                       "class_order": CLASS_NAMES}, f, indent=2)
    return {"accuracy": acc, "macro_f1": macro_f1, "weighted_f1": weighted_f1}


def load_final_model():
    with open(MODEL_DIR / "training_config.json") as f:
        config = json.load(f)
    winner = config["overall_winner"]
    if winner == "classical":
        model = joblib.load(MODEL_DIR / "model_classical.joblib")
        return "classical", model, config
    ckpt = torch.load(MODEL_DIR / "model_lstm.pt", weights_only=False)
    model = CurlLSTM(input_dim=ckpt["input_dim"], num_classes=len(CLASS_NAMES))
    model.load_state_dict(ckpt["state_dict"])
    model.eval()
    return "lstm", (model, ckpt["mode"]), config


def predict_classical(model, sub_df, feature_cols=AGGREGATE_FEATURE_NAMES):
    X = sub_df[feature_cols].values
    return model.predict(X)


def predict_lstm(model_tuple, data, indices, batch_size=64):
    model, mode = model_tuple
    ds = CurlSequenceDataset(data, indices, mode, CLASS_TO_IDX)
    loader = DataLoader(ds, batch_size=batch_size, shuffle=False, collate_fn=collate_fn)
    preds, labels = [], []
    with torch.no_grad():
        for feats, lengths, y in loader:
            logits = model(feats, lengths)
            preds.extend(logits.argmax(dim=1).tolist())
            labels.extend(y.tolist())
    return np.array(preds), np.array(labels)


def evaluate_final_model(model_type, model_obj, split, feature_cols=AGGREGATE_FEATURE_NAMES):
    seq_df = pd.read_csv(PROCESSED_DIR / "sequence_features.csv")
    data = load_sequences_npz(PROCESSED_DIR / "sequences.npz") if model_type == "lstm" else None

    summary = {}
    for part, base_ids in split.items():
        if model_type == "classical":
            sub_df = seq_df[seq_df["base_id"].isin(base_ids)]
            y_true = sub_df["class_label"].map(CLASS_TO_IDX).values
            y_pred = predict_classical(model_obj, sub_df, feature_cols)
            video_ids = sub_df["video_id"].values
            is_original = sub_df["is_original"].values
        else:
            idx = indices_for_base_ids(data, base_ids)
            y_pred, y_true = predict_lstm(model_obj, data, idx)
            video_ids = data["video_ids"][idx]
            is_original = data["is_original"][idx]

        summary[part] = evaluate_predictions(f"FINAL MODEL - {part} (all variants)", y_true, y_pred)

        orig_mask = np.asarray(is_original, dtype=bool)
        if orig_mask.sum() > 0:
            summary[f"{part}_orig_only"] = evaluate_predictions(
                f"FINAL MODEL - {part} (ORIGINAL clips only, n={orig_mask.sum()})",
                y_true[orig_mask], y_pred[orig_mask])

        if part == "test":
            per_recording = {}
            base_id_arr = (seq_df[seq_df["base_id"].isin(base_ids)]["base_id"].values
                            if model_type == "classical" else data["base_ids"][idx])
            for bid in sorted(set(base_id_arr)):
                mask = np.asarray(base_id_arr) == bid
                per_recording[bid] = {
                    "num_sequences": int(mask.sum()),
                    "accuracy": float(accuracy_score(y_true[mask], y_pred[mask])),
                    "true_class": CLASS_NAMES[int(y_true[mask][0])],
                }
            with open(REPORT_DIR / "test_per_source_recording.json", "w") as f:
                json.dump(per_recording, f, indent=2)
            print("\nPer-source-recording TEST accuracy:")
            for bid, m in per_recording.items():
                print(f"  {bid} (true={m['true_class']:8s} n={m['num_sequences']:2d}): acc={m['accuracy']:.3f}")

    return summary


def evaluate_all_candidates_diagnostic(split, feature_cols=AGGREGATE_FEATURE_NAMES):
    """Reproduces the shortcut-learning diagnosis from development: every
    LSTM channel + the classical baseline, evaluated on train/val/test.
    """
    data = load_sequences_npz(PROCESSED_DIR / "sequences.npz")
    seq_df = pd.read_csv(PROCESSED_DIR / "sequence_features.csv")
    candidates_dir = MODEL_DIR / "candidates"
    diagnosis = {}

    for mode in ["raw", "engineered", "combo"]:
        ckpt_path = candidates_dir / f"lstm_{mode}.pt"
        if not ckpt_path.exists():
            continue
        ckpt = torch.load(ckpt_path, weights_only=False)
        model = CurlLSTM(input_dim=ckpt["input_dim"], num_classes=len(CLASS_NAMES))
        model.load_state_dict(ckpt["state_dict"])
        model.eval()
        diagnosis[f"lstm_{mode}"] = {}
        for part, base_ids in split.items():
            idx = indices_for_base_ids(data, base_ids)
            y_pred, y_true = predict_lstm((model, mode), data, idx)
            diagnosis[f"lstm_{mode}"][part] = {
                "accuracy": float(accuracy_score(y_true, y_pred)),
                "macro_f1": float(f1_score(y_true, y_pred, average="macro", zero_division=0)),
                "n_sequences": len(y_true),
            }

    clf_path = candidates_dir / "classical_train_only.joblib"
    if clf_path.exists():
        clf = joblib.load(clf_path)
        diagnosis["classical_train_only"] = {}
        for part, base_ids in split.items():
            sub_df = seq_df[seq_df["base_id"].isin(base_ids)]
            y_true = sub_df["class_label"].map(CLASS_TO_IDX).values
            y_pred = predict_classical(clf, sub_df, feature_cols)
            diagnosis["classical_train_only"][part] = {
                "accuracy": float(accuracy_score(y_true, y_pred)),
                "macro_f1": float(f1_score(y_true, y_pred, average="macro", zero_division=0)),
                "n_sequences": len(y_true),
            }

    with open(REPORT_DIR / "all_candidates_comparison.json", "w") as f:
        json.dump(diagnosis, f, indent=2)

    print("\n=== All-candidates comparison (train/val/test) -- shortcut-learning check ===")
    for cand, parts in diagnosis.items():
        line = "  ".join(f"{p}: acc={m['accuracy']:.3f} f1={m['macro_f1']:.3f}" for p, m in parts.items())
        print(f"  {cand:22s} {line}")
    return diagnosis


def plot_training_curves():
    hist_path = CURVES_DIR / "lstm_history.json"
    if hist_path.exists():
        with open(hist_path) as f:
            hist = json.load(f)
        fig, axes = plt.subplots(1, 2, figsize=(11, 4))
        axes[0].plot(hist["train_loss"], label="train"); axes[0].plot(hist["val_loss"], label="val")
        axes[0].set_xlabel("epoch"); axes[0].set_ylabel("loss"); axes[0].set_title("LSTM loss"); axes[0].legend()
        axes[1].plot(hist["train_f1"], label="train"); axes[1].plot(hist["val_f1"], label="val")
        axes[1].set_xlabel("epoch"); axes[1].set_ylabel("macro F1"); axes[1].set_title("LSTM macro-F1"); axes[1].legend()
        fig.tight_layout()
        fig.savefig(CURVES_DIR / "lstm_curves.png", dpi=150)
        plt.close(fig)


def main():
    CM_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    CURVES_DIR.mkdir(parents=True, exist_ok=True)

    with open(PROCESSED_DIR / "base_id_split.json") as f:
        split = json.load(f)
    with open(MODEL_DIR / "training_config.json") as f:
        config = json.load(f)
    feature_cols = config.get("selected_features", AGGREGATE_FEATURE_NAMES)

    print("Evaluating all trained candidates (train/val/test) for the shortcut-learning check...")
    evaluate_all_candidates_diagnostic(split, feature_cols)

    model_type, model_obj, config = load_final_model()
    print(f"\n\nFinal saved model type: {model_type}")
    if model_type == "classical":
        print(f"  {config['best_classical_type']} {config['best_classical_params']} "
              f"(feature_set={config.get('best_classical_feature_set', 'full')}, "
              f"{len(feature_cols)}/{len(AGGREGATE_FEATURE_NAMES)} features)")
        if hasattr(model_obj, "feature_importances_"):
            order = np.argsort(model_obj.feature_importances_)[::-1]
            top = [{"feature": feature_cols[i], "importance": float(model_obj.feature_importances_[i])}
                   for i in order[:15]]
            with open(REPORT_DIR / "feature_importance.json", "w") as f:
                json.dump(top, f, indent=2)
            print("  Top feature importances (sanity check against class semantics):")
            for row in top[:10]:
                print(f"    {row['feature']:35s} {row['importance']:.4f}")
    else:
        print(f"  LSTM mode={model_obj[1]}")

    summary = evaluate_final_model(model_type, model_obj, split, feature_cols)
    plot_training_curves()

    with open(REPORT_DIR / "summary.json", "w") as f:
        json.dump(summary, f, indent=2)

    headline = config.get("headline_generalization_metric")
    print("\n" + "=" * 70)
    if headline:
        print(f"HEADLINE GENERALIZATION ESTIMATE (report this number, not test accuracy):")
        print(f"  {headline['name']}: {headline['value']:.4f} (+/- {headline['std']:.4f})")
        print(f"  {headline['note']}")
    print("=" * 70)
    print("\n=== FINAL MODEL SUMMARY (accuracy / macro-F1 / weighted-F1) ===")
    print("(train/val numbers below are optimistic -- val was folded into the final refit;")
    print(" test is only 8 independent recordings, so treat it as illustrative, not definitive)")
    for name, m in summary.items():
        print(f"{name:16s}: acc={m['accuracy']:.4f}  macroF1={m['macro_f1']:.4f}  weightedF1={m['weighted_f1']:.4f}")

    print(f"\nSaved confusion matrices to {CM_DIR}")
    print(f"Saved classification reports to {REPORT_DIR}")
    print(f"Saved training curves to {CURVES_DIR}")


if __name__ == "__main__":
    main()
