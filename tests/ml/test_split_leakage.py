"""Guards against the data leak ml/README.md warns about.

Every recording is stored 11 times (_orig + 10 _aug copies), and each
"incomplete_vid_NN" row is a truncated copy of "vid_NN". If copies of one
recording end up in both train and test, test accuracy is inflated. These
tests fail if that ever happens.
"""
import json
import sys
from pathlib import Path

import pandas as pd
import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from ml.src.preprocessing.dataset_io import BASE_ID_RE  # noqa: E402

PROCESSED = REPO / "ml" / "data" / "processed"
CLASSES = {"Perfect", "Drag", "Swing", "Half", "Heave", "Incomplete"}


def base_id(video_id: str) -> str:
    match = BASE_ID_RE.search(video_id)
    assert match, f"no base id in {video_id!r}"
    return match.group(1)


@pytest.mark.parametrize(
    "video_id",
    ["vid_0025_orig", "vid_0025_aug_3", "incomplete_vid_0025_aug_3", "incomplete_vid_0025_orig"],
)
def test_all_copies_of_a_recording_share_one_base_id(video_id):
    assert base_id(video_id) == "vid_0025"


def test_split_base_ids_are_disjoint_and_complete():
    pytest.importorskip("sklearn")
    from ml.scripts.prepare_dataset import split_base_ids

    labels = {f"vid_{i:04d}": cls for i, cls in enumerate(["Perfect", "Drag", "Half", "Heave", "Swing"] * 8)}
    split = split_base_ids(labels)
    train, val, test = (set(split[k]) for k in ("train", "val", "test"))
    assert not (train & val) and not (train & test) and not (val & test)
    assert train | val | test == set(labels)
    assert split == split_base_ids(labels), "split must be repeatable with the fixed seed"


@pytest.fixture(scope="module")
def committed_split():
    path = PROCESSED / "base_id_split.json"
    if not path.exists():
        pytest.skip("no committed split")
    return {k: set(v) for k, v in json.loads(path.read_text()).items() if k in ("train", "val", "test")}


def test_committed_split_has_no_overlap(committed_split):
    train, val, test = committed_split["train"], committed_split["val"], committed_split["test"]
    assert not (train & val), train & val
    assert not (train & test), train & test
    assert not (val & test), val & test


def test_every_feature_row_belongs_to_exactly_one_split(committed_split):
    path = PROCESSED / "sequence_features.csv"
    if not path.exists():
        pytest.skip("no committed features")
    rows = pd.read_csv(path, usecols=["video_id", "base_id", "class_label"])
    assert (rows["video_id"].map(base_id) == rows["base_id"]).all(), "base_id column disagrees with video_id"
    assigned = set().union(*committed_split.values())
    missing = set(rows["base_id"]) - assigned
    assert not missing, f"recordings in no split: {sorted(missing)}"
    assert set(rows["class_label"]) <= CLASSES
