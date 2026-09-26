"""Loading the PhysioVision bicep-curl CSV dataset.

The provided ZIP contains a single `reduced.csv`: 37,439 rows, one per
(video, frame), with columns video_id, class_label, frame_number, and
x0..x32/y0..y32/z0..z32 (MediaPipe Pose world landmarks). Inspection found:

- video_id encodes 49 independent SOURCE recordings ("vid_0001" ..
  "vid_0049"), each stored 11 times: one "_orig" copy plus ten "_aug_0"
  .. "_aug_9" pre-generated augmented copies (539 video_id values total).
- Every one of the 11 copies of a given source video shares the same
  class_label (augmentation does not relabel).
- Class distribution over the 49 *source* recordings: Perfect=17,
  Drag=8, Half=8, Heave=8, Swing=8.

This means video_id is NOT an independent unit -- an "_orig" video and its
"_aug_3" sibling are near-duplicates of the same underlying performance.
Splitting by video_id would leak near-identical examples across
train/val/test. `base_id` (the "vid_00NN" prefix) is the true independent
unit and is what all splitting must group by.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

from . import landmarks as lm

BASE_ID_RE = re.compile(r"(vid_\d+)_")


@dataclass
class RawSequence:
    video_id: str
    base_id: str          # true independent source-recording id
    is_original: bool      # True for the "_orig" copy, False for "_aug_*"
    class_label: str
    keypoints: np.ndarray   # (T, 33, 3)
    num_frames: int


def load_all_sequences(csv_path: str) -> list[RawSequence]:
    df = pd.read_csv(csv_path)
    required = {"video_id", "class_label", "frame_number"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"CSV is missing required columns: {missing}")

    sequences: list[RawSequence] = []
    for video_id, group in df.groupby("video_id", sort=True):
        group = group.sort_values("frame_number")
        base_match = BASE_ID_RE.match(video_id)
        base_id = base_match.group(1) if base_match else video_id
        is_original = video_id.endswith("_orig")

        labels = group["class_label"].unique()
        if len(labels) != 1:
            raise ValueError(f"{video_id} has inconsistent labels: {labels}")

        kps = lm.frames_from_dataframe(group)
        sequences.append(RawSequence(
            video_id=video_id, base_id=base_id, is_original=is_original,
            class_label=labels[0], keypoints=kps, num_frames=len(group),
        ))

    sequences.sort(key=lambda s: s.video_id)
    return sequences
