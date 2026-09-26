"""Loading the raw provided dataset (COCO-style per-video JSON files).

The uploaded ZIP (`VidData/VidData/000000.json` ... `000030.json`, each with
a matching `.mp4`) contains, for every one of its 31 videos, one synthetic
avatar with a unique body shape performing a standing dumbbell bicep curl.
Every video already is bicep-curl data -- inspection confirmed the
`categories` field is identical (`person`, `dumbbell`) across all 31 files
and no other exercise/equipment type appears anywhere, and 6 sampled videos
were visually confirmed to show the same curl motion. So "extracting only
the bicep exercise data" here means: use all 31 sequences, since there is
nothing else in this ZIP to filter out. This module only reads the JSON
(pose/mocap) side; the .mp4 videos are not needed for a landmark-based model
and are left untouched.
"""
from __future__ import annotations

import json
import zipfile
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from . import landmarks as lm


@dataclass
class RawSequence:
    subject_id: str          # unique per avatar/video (there is exactly one sequence per subject)
    video_number: int
    gender: str
    keypoints: np.ndarray     # (T, 17, 3) COCO17 (x, y, visibility), pixel space
    rep_count: np.ndarray     # (T,) continuous rep-progress value from the dataset (reference only)
    num_frames: int


def _parse_json_bytes(raw_bytes: bytes) -> RawSequence:
    data = json.loads(raw_bytes)
    info = data["info"]
    images_by_id = {im["id"]: im for im in data["images"]}
    person_anns = {a["image_id"]: a for a in data["annotations"] if a["category_id"] == 0}

    frame_ids = sorted(images_by_id.keys())
    kps = np.zeros((len(frame_ids), lm.NUM_KEYPOINTS, 3), dtype=float)
    rep_count = np.zeros(len(frame_ids), dtype=float)
    for t, fid in enumerate(frame_ids):
        rep_count[t] = images_by_id[fid]["rep_count"]
        kps[t] = lm.keypoints_from_coco_annotation(person_anns[fid]["keypoints"])

    subject_id = f"subj_{info['video_number']:03d}"
    return RawSequence(
        subject_id=subject_id,
        video_number=info["video_number"],
        gender=info.get("avatar_presenting_gender", "unknown"),
        keypoints=kps,
        rep_count=rep_count,
        num_frames=len(frame_ids),
    )


def load_all_sequences(raw_source: str) -> list[RawSequence]:
    """Load every bicep-curl sequence's JSON from either a directory
    containing the extracted `*.json` files, or the original ZIP file
    directly (never modified -- opened read-only).
    """
    path = Path(raw_source)
    sequences: list[RawSequence] = []

    if path.is_dir():
        json_files = sorted(path.glob("*.json"))
        if not json_files:
            # maybe raw_source points at the zip's top folder; search recursively
            json_files = sorted(path.rglob("*.json"))
        for jf in json_files:
            sequences.append(_parse_json_bytes(jf.read_bytes()))
    elif path.suffix.lower() == ".zip":
        with zipfile.ZipFile(path, "r") as zf:
            names = sorted(n for n in zf.namelist() if n.lower().endswith(".json"))
            for name in names:
                sequences.append(_parse_json_bytes(zf.read(name)))
    else:
        raise ValueError(f"raw_source must be a directory or .zip file, got: {raw_source}")

    sequences.sort(key=lambda s: s.video_number)
    return sequences
