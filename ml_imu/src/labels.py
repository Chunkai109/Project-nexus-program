"""Single source of truth for the IMU classifier's class label <-> index
mapping. Only 4 classes have any examples in ml_imu/data/imu_labels.csv --
"Swing" and "Incomplete" (present in the vision model's taxonomy) have zero
representation in this dataset and are deliberately not included here; see
ml_imu/README.md.
"""
CLASS_NAMES = ["Perfect", "Drag", "Half", "Heave"]
CLASS_TO_IDX = {c: i for i, c in enumerate(CLASS_NAMES)}
IDX_TO_CLASS = {i: c for c, i in CLASS_TO_IDX.items()}
