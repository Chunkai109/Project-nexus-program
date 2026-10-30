# FIT1061 H2: Squat validity classifier (logistic regression)

Standalone coursework project, separate from the `ml/` vision pipeline in this repo.

## Setup

1. Unzip `Plan_A.zip` into `fit1061_h2/data/` so that `data/Squat_Data/Squat_Data/{Valid,Invalid}/<video>/<frame>.npy` exists (git-ignored).
2. `pip install numpy pandas matplotlib scikit-learn jupyter`
3. Run notebooks from inside `fit1061_h2/`.

## Lessons

| Notebook | Covers | Output |
|---|---|---|
| `01_cleaning_and_feature_extraction.ipynb` | loading in frame order, empty/low-visibility frame removal, duplicate check, knee angle + hip drop per frame, one row per video, the mixed-Invalid-class finding | `outputs/features.csv`, `outputs/cleaning_report.csv` |
