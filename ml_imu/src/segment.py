"""Rep segmentation for sessions where the device's own State/Reps fields
can't locate individual repetitions (tests 31-35: hands never fully return
down between reps, so the device's State stays "TOP" for the whole session
after one initial transition -- see ml_imu/README.md for the full
investigation).

Uses prominence-thresholded peak detection directly on the raw Flex curve,
NOT naive velocity (first-difference) zero-crossing -- that was tried first
and produced noisy, spurious crossings during static/settling periods
(confirmed empirically, not assumed). Peaks in Flex mark the top of a rep;
the midpoint between consecutive peaks' surrounding troughs gives each
rep's frame boundaries.
"""
from __future__ import annotations

from scipy.signal import find_peaks
import numpy as np

DEFAULT_PROMINENCE = 20.0
DEFAULT_MIN_DISTANCE = 40  # frames; merges the near-duplicate detections
                           # seen in testing (e.g. two peaks 9 frames apart)


def find_reps(flex: np.ndarray, prominence: float = DEFAULT_PROMINENCE,
              distance: int = DEFAULT_MIN_DISTANCE) -> list[tuple[int, int]]:
    """Return (start_frame, end_frame) bounds for each detected rep, one
    per peak in `flex`. Boundaries are the troughs immediately before/after
    each peak (or the session start/end for the first/last rep), so
    consecutive reps' segments are contiguous and cover the whole session.
    """
    peaks, _ = find_peaks(flex, prominence=prominence, distance=distance)
    if len(peaks) == 0:
        return []

    troughs, _ = find_peaks(-flex, prominence=prominence, distance=distance)

    bounds = []
    n = len(flex)
    for peak in peaks:
        prior_troughs = troughs[troughs < peak]
        start = int(prior_troughs[-1]) if len(prior_troughs) else 0
        later_troughs = troughs[troughs > peak]
        end = int(later_troughs[0]) if len(later_troughs) else n - 1
        bounds.append((start, end))
    return bounds
