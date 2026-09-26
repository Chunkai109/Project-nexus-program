"""Single source of truth for the class label <-> index mapping, imported by
every training/evaluation/inference module. Fixed, explicit order (not
sklearn's LabelEncoder, which sorts alphabetically and is easy to
accidentally mismatch against a manually-built mapping elsewhere).
"""
CLASS_NAMES = ["Perfect", "Drag", "Swing", "Half", "Heave", "Incomplete"]
CLASS_TO_IDX = {c: i for i, c in enumerate(CLASS_NAMES)}
IDX_TO_CLASS = {i: c for c, i in CLASS_TO_IDX.items()}
