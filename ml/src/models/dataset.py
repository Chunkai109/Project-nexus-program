"""PyTorch Dataset/collate for the variable-length curl sequences saved by
prepare_dataset.py (ml/data/processed/sequences.npz).
"""
from __future__ import annotations

import numpy as np
import torch
from torch.utils.data import Dataset


def load_sequences_npz(path):
    data = np.load(path, allow_pickle=True)
    return {
        "video_ids": data["video_ids"],
        "base_ids": data["base_ids"],
        "labels": data["labels"],
        "is_original": data["is_original"],
        "engineered": data["engineered"],
        "raw": data["raw"],
    }


def select_channel(engineered: np.ndarray, raw: np.ndarray, mode: str) -> np.ndarray:
    if mode == "engineered":
        return engineered
    if mode == "raw":
        return raw
    if mode == "combo":
        return np.concatenate([raw, engineered], axis=1)
    raise ValueError(f"unknown input mode: {mode}")


class CurlSequenceDataset(Dataset):
    def __init__(self, data: dict, indices: list[int], mode: str, class_to_idx: dict[str, int]):
        self.data = data
        self.indices = indices
        self.mode = mode
        self.class_to_idx = class_to_idx

    def __len__(self):
        return len(self.indices)

    def __getitem__(self, i):
        idx = self.indices[i]
        feats = select_channel(self.data["engineered"][idx], self.data["raw"][idx], self.mode)
        label = self.class_to_idx[self.data["labels"][idx]]
        return torch.tensor(feats, dtype=torch.float32), label


def collate_fn(batch):
    feats, labels = zip(*batch)
    lengths = torch.tensor([f.shape[0] for f in feats], dtype=torch.long)
    max_len = int(lengths.max())
    dim = feats[0].shape[1]
    padded = torch.zeros(len(feats), max_len, dim, dtype=torch.float32)
    for i, f in enumerate(feats):
        padded[i, : f.shape[0]] = f
    labels = torch.tensor(labels, dtype=torch.long)
    return padded, lengths, labels


def indices_for_base_ids(data: dict, base_ids: list[str]) -> list[int]:
    base_id_set = set(base_ids)
    return [i for i, b in enumerate(data["base_ids"]) if b in base_id_set]
