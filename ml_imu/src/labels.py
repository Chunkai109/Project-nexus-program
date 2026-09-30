"""Single source of truth for the IMU classifier's class label <-> index
mapping.

"Swing" (test_ids 36-40) and "Incomplete" (test_id 41 only) were added from
a second data-collection batch -- both are thin: Swing's 5 sessions show a
Drift signature that looks more like a sensor-calibration offset than real
swing motion (flagged, trained on as-is per an explicit decision -- see
ml_imu/README.md), and Incomplete has exactly ONE real example (4 of the 5
candidate recordings turned out to show a completed rep-cycle, not a
truncated one, and were excluded rather than mislabeled). Treat both
classes' numbers with more caution than Perfect/Drag/Half/Heave, which have
5-17 sessions each.
"""
CLASS_NAMES = ["Perfect", "Drag", "Swing", "Half", "Heave", "Incomplete"]
CLASS_TO_IDX = {c: i for i, c in enumerate(CLASS_NAMES)}
IDX_TO_CLASS = {i: c for c, i in CLASS_TO_IDX.items()}
