"""Loading the PhysioVision bicep-curl CSV dataset.

Base format: one row per (video, frame), with columns video_id, class_label,
frame_number, and x0..x32/y0..y32/z0..z32 (MediaPipe Pose world landmarks).
Inspection found:

- video_id encodes 49 independent SOURCE recordings ("vid_0001" ..
  "vid_0049"), each stored 11 times: one "_orig" copy plus ten "_aug_0"
  .. "_aug_9" pre-generated augmented copies.
- Every one of the 11 copies of a given source video shares the same
  class_label (augmentation does not relabel).
- Class distribution over the 49 *source* recordings: Perfect=17,
  Drag=8, Half=8, Heave=8, Swing=8.

This means video_id is NOT an independent unit -- an "_orig" video and its
"_aug_3" sibling are near-duplicates of the same underlying performance.
Splitting by video_id would leak near-identical examples across
train/val/test. `base_id` (the "vid_00NN" prefix) is the true independent
unit and is what all splitting must group by.

A later dataset version (`bicep_with_incomplete.csv`) adds a 6th class,
"Incomplete", as `incomplete_vid_00NN_*` rows. Verified by direct
comparison: these are NOT new independent recordings -- they are the exact
same frame data as the corresponding `vid_00NN_*` "Perfect" recording,
truncated to a randomized fraction (observed range ~19%-83%) of its full
length, simulating a trainee stopping partway through a rep. Because the
truncated frames are byte-identical to a prefix of the untruncated
recording, `incomplete_vid_0025_aug_3` and `vid_0025_aug_3` MUST resolve to
the same `base_id` ("vid_0025") -- otherwise splitting could put literally
overlapping frame data in both train and test. The base_id regex below
matches the "vid_00NN" pattern wherever it appears in the string (not just
at the start) specifically so the "incomplete_" prefix doesn't break this.
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
    is_truncated: bool      # True for "incomplete_*" rows (see module docstring)
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
        base_match = BASE_ID_RE.search(video_id)  # search, not match: "incomplete_" can prefix it
        if base_match is None:
            raise ValueError(f"could not extract a base_id (vid_NNNN) from video_id: {video_id!r}")
        base_id = base_match.group(1)
        is_original = video_id.endswith("_orig")
        is_truncated = video_id.startswith("incomplete_")

        labels = group["class_label"].unique()
        if len(labels) != 1:
            raise ValueError(f"{video_id} has inconsistent labels: {labels}")

        kps = lm.frames_from_dataframe(group)
        sequences.append(RawSequence(
            video_id=video_id, base_id=base_id, is_original=is_original,
            is_truncated=is_truncated, class_label=labels[0],
            keypoints=kps, num_frames=len(group),
        ))

    sequences.sort(key=lambda s: s.video_id)
    return sequences
