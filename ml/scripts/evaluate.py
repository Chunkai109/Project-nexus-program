#!/usr/bin/env python3
"""Full evaluation of the saved model on TRAIN, VAL, and the held-out TEST
subjects (the ones never used in model selection or refitting). Produces:

  results/confusion_matrix/{split}_confusion_matrix.png
  results/classification_report/{split}_classification_report.json / .txt
  results/classification_report/test_per_subject_accuracy.json
  results/training_curves/*.png  (rendered from the JSON saved by train.py)
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import joblib
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.metrics import (accuracy_score, classification_report,
                              confusion_matrix, f1_score)

ML_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ML_ROOT.parent
sys.path.insert(0, str(REPO_ROOT))

from ml.src.features.engineer import FEATURE_NAMES

PROCESSED_DIR = ML_ROOT / "data" / "processed"
MODEL_DIR = ML_ROOT / "models" / "best_model"
RESULTS_DIR = ML_ROOT / "results"
CM_DIR = RESULTS_DIR / "confusion_matrix"
REPORT_DIR = RESULTS_DIR / "classification_report"
CURVES_DIR = RESULTS_DIR / "training_curves"


def load_everything():
    df = pd.read_csv(PROCESSED_DIR / "bicep_curl_phases.csv")
    with open(PROCESSED_DIR / "subject_split.json") as f:
        split = json.load(f)
    model = joblib.load(MODEL_DIR / "model.joblib")
    encoder = joblib.load(MODEL_DIR / "label_encoder.joblib")
    return df, split, model, encoder


def xy(df, subject_ids, encoder):
    sub_df = df[df["subject_id"].isin(subject_ids)]
    X = sub_df[FEATURE_NAMES].values
    y = encoder.transform(sub_df["label"].values)
    return X, y, sub_df


def plot_confusion_matrix(cm, class_names, title, out_path):
    fig, ax = plt.subplots(figsize=(6, 5))
    im = ax.imshow(cm, cmap="Blues")
    ax.set_xticks(range(len(class_names)))
    ax.set_yticks(range(len(class_names)))
    ax.set_xticklabels(class_names, rotation=45, ha="right")
    ax.set_yticklabels(class_names)
    ax.set_xlabel("Predicted")
    ax.set_ylabel("Actual")
    ax.set_title(title)
    thresh = cm.max() / 2.0
    for i in range(cm.shape[0]):
        for j in range(cm.shape[1]):
            ax.text(j, i, str(cm[i, j]), ha="center", va="center",
                     color="white" if cm[i, j] > thresh else "black")
    fig.colorbar(im, ax=ax)
    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    plt.close(fig)


def evaluate_split(name, X, y, sub_df, model, encoder):
    pred = model.predict(X)
    proba = model.predict_proba(X) if hasattr(model, "predict_proba") else None
    acc = accuracy_score(y, pred)
    macro_f1 = f1_score(y, pred, average="macro")
    weighted_f1 = f1_score(y, pred, average="weighted")
    report = classification_report(y, pred, target_names=list(encoder.classes_),
                                    output_dict=True, zero_division=0)
    cm = confusion_matrix(y, pred, labels=range(len(encoder.classes_)))

    print(f"\n=== {name.upper()} ===")
    print(f"Accuracy: {acc:.4f}  |  Classification error: {1 - acc:.4f}")
    print(f"Macro F1: {macro_f1:.4f}  |  Weighted F1: {weighted_f1:.4f}")
    print(classification_report(y, pred, target_names=list(encoder.classes_), zero_division=0))

    plot_confusion_matrix(cm, list(encoder.classes_), f"{name} confusion matrix",
                           CM_DIR / f"{name}_confusion_matrix.png")
    with open(REPORT_DIR / f"{name}_classification_report.json", "w") as f:
        json.dump({
            "accuracy": acc, "classification_error": 1 - acc,
            "macro_f1": macro_f1, "weighted_f1": weighted_f1,
            "per_class": report,
            "confusion_matrix": cm.tolist(),
            "class_order": list(encoder.classes_),
        }, f, indent=2)

    if name == "test":
        per_subject = {}
        for sid in sorted(sub_df["subject_id"].unique()):
            mask = (sub_df["subject_id"] == sid).values
            y_s, pred_s = y[mask], pred[mask]
            per_subject[sid] = {
                "num_frames": int(mask.sum()),
                "accuracy": float(accuracy_score(y_s, pred_s)),
                "macro_f1": float(f1_score(y_s, pred_s, average="macro", zero_division=0)),
            }
        with open(REPORT_DIR / "test_per_subject_accuracy.json", "w") as f:
            json.dump(per_subject, f, indent=2)
        print("\nPer-subject TEST accuracy:")
        for sid, m in per_subject.items():
            print(f"  {sid}: acc={m['accuracy']:.3f}  macroF1={m['macro_f1']:.3f}  (n={m['num_frames']})")

    return {"accuracy": acc, "macro_f1": macro_f1, "weighted_f1": weighted_f1}


def plot_training_curves():
    xgb_path = CURVES_DIR / "xgboost_eval_history.json"
    rf_path = CURVES_DIR / "rf_complexity_curve.json"

    if xgb_path.exists():
        with open(xgb_path) as f:
            hist = json.load(f)
        train_loss = hist["validation_0"]["mlogloss"]
        val_loss = hist["validation_1"]["mlogloss"]
        fig, ax = plt.subplots(figsize=(6, 4))
        ax.plot(train_loss, label="train")
        ax.plot(val_loss, label="validation")
        ax.set_xlabel("boosting round")
        ax.set_ylabel("multiclass log loss")
        ax.set_title("XGBoost training vs validation loss")
        ax.legend()
        fig.tight_layout()
        fig.savefig(CURVES_DIR / "loss_curve.png", dpi=150)
        plt.close(fig)

    if rf_path.exists():
        with open(rf_path) as f:
            curve = json.load(f)
        fig, ax = plt.subplots(figsize=(6, 4))
        ax.plot(curve["n_estimators"], curve["train_macro_f1"], marker="o", label="train")
        ax.plot(curve["n_estimators"], curve["val_macro_f1"], marker="o", label="validation")
        ax.set_xlabel("n_estimators")
        ax.set_ylabel("macro F1")
        ax.set_title("RandomForest: macro F1 vs model complexity\n(no per-epoch loss exists for RF; this is the analogous over/underfitting diagnostic)")
        ax.legend()
        fig.tight_layout()
        fig.savefig(CURVES_DIR / "complexity_curve.png", dpi=150)
        plt.close(fig)


def main():
    CM_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    CURVES_DIR.mkdir(parents=True, exist_ok=True)

    df, split, model, encoder = load_everything()

    summary = {}
    for name, ids in split.items():
        X, y, sub_df = xy(df, ids, encoder)
        summary[name] = evaluate_split(name, X, y, sub_df, model, encoder)

    plot_training_curves()

    with open(REPORT_DIR / "summary.json", "w") as f:
        json.dump(summary, f, indent=2)

    print("\n=== SUMMARY (accuracy / macro-F1 / weighted-F1) ===")
    for name, m in summary.items():
        print(f"{name:6s}: acc={m['accuracy']:.4f}  macroF1={m['macro_f1']:.4f}  weightedF1={m['weighted_f1']:.4f}")

    print(f"\nSaved confusion matrices to {CM_DIR}")
    print(f"Saved classification reports to {REPORT_DIR}")
    print(f"Saved training curves to {CURVES_DIR}")


if __name__ == "__main__":
    main()
