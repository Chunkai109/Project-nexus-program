"""A small, heavily-regularized bidirectional LSTM for whole-sequence
bicep-curl form classification.

Model-size rationale: with only 34 independent training source recordings
(374 sequences counting pre-generated augmentation, which are correlated
with each other, not independent), a large LSTM would overfit almost
immediately. This model is deliberately small: one bidirectional LSTM
layer with a modest hidden size, dropout on the input, between layers, and
before the final classifier, plus weight decay (L2) in the optimizer and
early stopping on validation macro-F1 (see scripts/train.py). Sequences are
mean-pooled over valid (non-padded) timesteps rather than using only the
final hidden state, which is more robust to the variable sequence lengths
(16-86 frames) in this dataset.
"""
from __future__ import annotations

import torch
import torch.nn as nn


class CurlLSTM(nn.Module):
    def __init__(self, input_dim: int, num_classes: int,
                 hidden_size: int = 32, num_layers: int = 1,
                 dropout: float = 0.4, bidirectional: bool = True):
        super().__init__()
        self.input_dropout = nn.Dropout(dropout)
        self.lstm = nn.LSTM(
            input_size=input_dim, hidden_size=hidden_size, num_layers=num_layers,
            batch_first=True, bidirectional=bidirectional,
            dropout=dropout if num_layers > 1 else 0.0,
        )
        out_dim = hidden_size * (2 if bidirectional else 1)
        self.head_dropout = nn.Dropout(dropout)
        self.classifier = nn.Linear(out_dim, num_classes)

    def forward(self, x: torch.Tensor, lengths: torch.Tensor) -> torch.Tensor:
        # x: (B, T, D), lengths: (B,)
        x = self.input_dropout(x)
        packed = nn.utils.rnn.pack_padded_sequence(
            x, lengths.cpu(), batch_first=True, enforce_sorted=False)
        packed_out, _ = self.lstm(packed)
        out, _ = nn.utils.rnn.pad_packed_sequence(packed_out, batch_first=True)
        # Mean-pool over valid timesteps only.
        mask = torch.arange(out.size(1), device=out.device)[None, :] < lengths[:, None].to(out.device)
        mask = mask.unsqueeze(-1).float()
        summed = (out * mask).sum(dim=1)
        pooled = summed / lengths.to(out.device).float().unsqueeze(-1).clamp(min=1)
        pooled = self.head_dropout(pooled)
        return self.classifier(pooled)
