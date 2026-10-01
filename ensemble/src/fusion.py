"""Fusion logic combining the vision model's (ml/) and IMU model's
(ml_imu/) predictions into one result.

CRITICAL, LEADING CAVEAT (see ensemble/README.md for the full version):
this logic is built and unit-tested for CORRECTNESS, not validated for
real-world benefit. No synchronized dual-sensor recording exists -- the
two datasets were collected completely separately -- so there is currently
no way to check whether fusing actually helps versus using the vision
model alone. Treat every number this module produces as illustrative of
the MECHANISM, not a validated accuracy claim.

This is a pure function operating on each model's own already-computed
result dict (from BicepCurlPredictor.end_session() and
ImuCurlPredictor.predict_from_arrays()) -- it does not reimplement any
session-buffering/streaming/feature-extraction logic belonging to either
model.

Three design decisions, resolved with the user and applied here exactly:

1. Label mismatch: the vision model has 6 classes; the IMU model
   originally covered only 4 (no real Swing/Incomplete data existed for
   it). A second data-collection batch added real Swing (5 sessions) and
   Incomplete (1 session) examples, so IMU now nominally covers all 6 --
   SHARED_CLASSES was widened to match. **This is a capability change, not
   a validated-improvement one**: Swing's data shows a Drift signature
   that looks more like a sensor-calibration offset than confirmed swing
   motion (trained on as-is per an explicit decision -- see
   ml_imu/README.md), and Incomplete has exactly ONE example, too few for
   GroupKFold to say anything reliable about it (one CV fold trains with
   zero Incomplete examples entirely). IMU's opinion on these two classes
   should be trusted considerably less than its opinion on Perfect/Drag/
   Half/Heave, which have 5-17 sessions each -- the fixed global
   `vision_weight` can't express that per-class difference, so this is a
   known, documented limitation of the current weighting, not an oversight.

2. Weighting: **50/50 (DEFAULT_VISION_WEIGHT = 0.5), set at the user's
   explicit request.** Flagged here plainly because it does NOT reflect a
   change in either model's validated standing: vision is still the one
   honestly-validated number in this system (~88.5% CV macro-F1, 34
   independent recordings); IMU's headline CV macro-F1 is 0.830 (up
   marginally from 0.822, within noise), but that number now also
   includes a third data batch where 5 of 15 friend-provided "Perfect"
   recordings were excluded before training because their own Drift
   values (21.8-28.5) matched this project's established Drag signature,
   not Perfect's -- and 8 of the 10 kept sit above the historical Perfect
   ceiling on that same feature, flagged but included. Moving weight
   toward IMU was requested specifically to make "Perfect" easier to
   trigger by influencing what IMU is trained to recognize; that request
   and this project's pushback on it are on the record in the session
   this change came from. The previous 80/20 default (vision favored,
   evidence-based) is preserved as the value to revert to if this
   weighting is reconsidered -- see git history for
   `DEFAULT_VISION_WEIGHT`.

3. Gate conflicts: if EITHER model's own gate rejects the input (vision's
   rest gate / novelty detector, or IMU's novelty gate), the ensemble
   reports a rejection rather than forcing a guess from whichever model
   didn't reject -- conservative by design.
"""
from __future__ import annotations

SHARED_CLASSES = ["Perfect", "Drag", "Swing", "Half", "Heave", "Incomplete"]
# Previously ["Swing", "Incomplete"] -- IMU had zero training data for
# either class, so vision's answer was used directly, bypassing IMU
# entirely for these two. Now that IMU has (thin, caveated -- see above)
# real data for both, they're fused like every other class instead of
# bypassed. Kept as an empty list, not deleted, so the bypass mechanism
# stays available if a class needs to revert to vision-only in the future
# (e.g. if Swing's drift signal turns out not to generalize).
VISION_EXCLUSIVE_CLASSES = []
VISION_REJECT_PREDICTIONS = {"no_exercise_detected", "unrecognized_movement"}
IMU_REJECT_PREDICTIONS = {"unrecognized_input"}
# 0.5, not the evidence-based 0.8 -- see design decision 2 above.
DEFAULT_VISION_WEIGHT = 0.5


def _restrict_and_renormalize(class_probabilities: dict, classes: list[str]) -> dict:
    """Restrict a probability dict to `classes` and renormalize so the
    subset sums to 1. Used to drop vision's Swing/Incomplete mass before
    blending with IMU -- explicitly documented as a real simplification:
    whatever probability vision put on Swing/Incomplete is discarded here,
    not silently redistributed by some more sophisticated method."""
    restricted = {c: class_probabilities[c] for c in classes}
    total = sum(restricted.values())
    if total <= 0:
        # Degenerate case (shouldn't happen with a real softmax-like output,
        # but guard against divide-by-zero): fall back to uniform.
        return {c: 1.0 / len(classes) for c in classes}
    return {c: v / total for c, v in restricted.items()}


def fuse_predictions(vision_result: dict, imu_result: dict,
                      vision_weight: float = DEFAULT_VISION_WEIGHT) -> dict:
    """Combine one vision-model result and one IMU-model result into a
    single ensemble result. See module docstring for the full reasoning.

    Returns a dict always containing: "exercise", "prediction", "source"
    (one of "rejected_by_vision_gate" / "rejected_by_imu_gate" /
    "vision_only_exclusive_class" / "fused"), "vision_result" and
    "imu_result" (the two inputs, unmodified, for transparency), plus
    prediction-specific fields (class_probabilities, confidence,
    good_form_score, message) depending on the branch taken.
    """
    if vision_result.get("prediction") in VISION_REJECT_PREDICTIONS:
        return {
            "exercise": "bicep_curl",
            "prediction": vision_result["prediction"],
            "confidence": None,
            "source": "rejected_by_vision_gate",
            "message": (
                f"Vision model's own gate rejected this input "
                f"({vision_result['prediction']}) -- the ensemble reports "
                f"this rejection rather than forcing a guess, even though "
                f"the IMU model may have had its own opinion."
            ),
            "vision_result": vision_result,
            "imu_result": imu_result,
        }

    if imu_result.get("prediction") in IMU_REJECT_PREDICTIONS:
        return {
            "exercise": "bicep_curl",
            "prediction": "unrecognized_input",
            "confidence": None,
            "source": "rejected_by_imu_gate",
            "message": (
                "IMU model's novelty gate rejected this input as not "
                "resembling anything in its training data -- the ensemble "
                "reports this rejection rather than forcing a guess, even "
                "though the vision model may have had its own opinion."
            ),
            "vision_result": vision_result,
            "imu_result": imu_result,
        }

    # Neither model produced a real classification (e.g. too few frames/
    # samples buffered -- BicepCurlPredictor.end_session() and
    # ImuCurlPredictor.predict_from_arrays() both signal this by leaving
    # "prediction" as None / absent, not via one of the named gate
    # rejections above). Without this check, the "fuse" branch below would
    # KeyError on an empty class_probabilities dict instead of degrading
    # gracefully -- a real risk once this function is called from
    # untrusted/malformed input (e.g. an API request), not just from the
    # two predictors' own well-formed output.
    if not vision_result.get("class_probabilities") or not imu_result.get("class_probabilities"):
        return {
            "exercise": "bicep_curl",
            "prediction": None,
            "confidence": None,
            "source": "insufficient_data",
            "message": (
                "At least one model did not produce a real classification "
                "(too few frames/samples buffered, or an internal error) -- "
                "see vision_result/imu_result for details. No fused "
                "prediction was made."
            ),
            "vision_result": vision_result,
            "imu_result": imu_result,
        }

    vision_proba = vision_result.get("class_probabilities", {})
    vision_top_class = max(vision_proba, key=vision_proba.get) if vision_proba else None

    if vision_top_class in VISION_EXCLUSIVE_CLASSES:
        return {
            "exercise": "bicep_curl",
            "prediction": vision_result["prediction"],
            "confidence": vision_result.get("confidence"),
            "good_form_score": vision_result.get("good_form_score"),
            "class_probabilities": vision_proba,
            "source": "vision_only_exclusive_class",
            "message": (
                f"Vision model's top prediction ({vision_top_class}) is a "
                f"class the IMU model has no real training data for -- "
                f"using vision's answer directly rather than blending in an "
                f"opinion IMU was never trained to give."
            ),
            "vision_result": vision_result,
            "imu_result": imu_result,
        }

    dropped_mass = sum(vision_proba.get(c, 0.0) for c in VISION_EXCLUSIVE_CLASSES)
    vision_shared = _restrict_and_renormalize(vision_proba, SHARED_CLASSES)
    imu_proba = imu_result.get("class_probabilities", {})
    imu_shared = _restrict_and_renormalize(imu_proba, SHARED_CLASSES)

    fused = {
        c: vision_weight * vision_shared[c] + (1 - vision_weight) * imu_shared[c]
        for c in SHARED_CLASSES
    }
    fused_prediction = max(fused, key=fused.get)
    fused_confidence = fused[fused_prediction]

    # good_form_score: blended P(Perfect), run through vision's existing
    # calibration anchor for display-scale consistency. Approximate --
    # that anchor was tuned for vision's raw model output alone, not a
    # blended score, and is documented as such.
    fused_good_form_score = None
    vision_anchor_score = vision_result.get("good_form_score_raw")
    vision_calibrated = vision_result.get("good_form_score")
    if vision_anchor_score is not None and vision_calibrated is not None and vision_anchor_score > 0:
        anchor = vision_anchor_score / vision_calibrated if vision_calibrated > 0 else None
        if anchor:
            fused_good_form_score = min(1.0, fused["Perfect"] / anchor)

    return {
        "exercise": "bicep_curl",
        "prediction": fused_prediction,
        "confidence": fused_confidence,
        "good_form_score": fused_good_form_score,
        "good_form_score_raw": fused["Perfect"],
        "class_probabilities": fused,
        "source": "fused",
        "vision_weight": vision_weight,
        "message": (
            f"Fused vision ({vision_weight:.0%} weight) and IMU "
            f"({1 - vision_weight:.0%} weight) over the {len(SHARED_CLASSES)} "
            f"shared classes. Vision's Swing/Incomplete probability mass "
            f"({dropped_mass:.3f} of 1.0) was dropped and the rest "
            f"renormalized before blending -- see ensemble/README.md for "
            f"why. This number is UNVALIDATED: no synchronized dual-sensor "
            f"data exists to confirm fusing helps."
        ),
        "vision_result": vision_result,
        "imu_result": imu_result,
    }
