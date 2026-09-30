/**
 * Client for the bicep-curl vision model's fusion API
 * (`ensemble/api/server.py`). That API is a separate local Python process
 * (like the ESP32 hub is separate hardware); this module just calls it over
 * HTTP and never assumes it's running.
 *
 * Two prediction functions, for two different situations:
 *  - predictVisionForm() calls the vision-only `/predict/vision` endpoint —
 *    used when there's no hub connected, so no real flex/drift exists to
 *    send at all.
 *  - predictFusedForm() calls the fused `/predict` endpoint with real
 *    flex/drift from the hub — used when a hub is connected. `emg` and
 *    `vib_on` are sent as fixed placeholders (0 / false for every sample)
 *    since neither is derived from a real, meaningful signal for this
 *    call — only flex/drift are. The API requires all four arrays to be
 *    present and the same length, so they can't just be omitted; see
 *    `ensemble/FRONTEND_INTEGRATION.md` Section 6 for the full reasoning
 *    (and why this means the IMU novelty gate rejecting as
 *    "unrecognized_input" is an expected, common outcome here, not a bug).
 */
import type { FlexDriftSample } from './hub/imuFlexDriftRecorder'

/** Default local address the fusion API listens on — see ensemble/api/server.py's own docstring for how to start it. */
export const DEFAULT_VISION_MODEL_URL = 'http://localhost:8000'

export const VISION_PREDICTION_CLASSES = [
  'Perfect', 'Drag', 'Swing', 'Half', 'Heave', 'Incomplete',
] as const
export type VisionPredictionClass = (typeof VISION_PREDICTION_CLASSES)[number]

export type VisionPredictionOutcome =
  | VisionPredictionClass
  | 'no_exercise_detected'
  | 'unrecognized_movement'
  | 'unrecognized_input' // fused-only: the IMU side's novelty gate rejecting

export interface VisionPrediction {
  exercise: 'bicep_curl'
  prediction: VisionPredictionOutcome | null
  confidence: number | null
  /** 0-1, calibrated P(Perfect) — the headline "how good did this rep look" number. Absent when prediction is null or a gate rejection. */
  good_form_score?: number
  class_probabilities?: Partial<Record<VisionPredictionClass, number>>
  message?: string
  num_frames?: number
}

export type FusedPredictionSource =
  | 'fused'
  | 'vision_only_exclusive_class'
  | 'rejected_by_vision_gate'
  | 'rejected_by_imu_gate'
  | 'insufficient_data'

/** Same shape as VisionPrediction, plus `source` — which branch of the fusion logic produced this result (see ensemble/src/fusion.py). Worth surfacing in the UI: "rejected_by_imu_gate" explains an otherwise-surprising rejection given real flex/drift was sent (expected here — see this file's module doc). */
export interface FusedPrediction extends VisionPrediction {
  source: FusedPredictionSource
}

/** One buffered rep's worth of MediaPipe Pose WORLD landmarks: T frames, each 33 [x, y, z] entries, in MediaPipe's standard landmark order (matches `ml/src/preprocessing/landmarks.py`'s MEDIAPIPE_LANDMARK_NAMES exactly, so no reordering is needed on either side). */
export type VisionFrames = number[][][]

/** Mirrors ensemble/api/server.py's own minimum — callers should check a buffer against this themselves (see LiveSession.tsx) before calling predictVisionForm, so a too-short rep can be told apart from a genuinely unreachable API instead of both looking like the same failure. */
export const MIN_VISION_FRAMES = 10

/**
 * POST a buffered rep to the vision model and return its classification.
 * Throws on a network failure (API not running — the common case during
 * normal use, since it's an optional local process), a non-2xx response, or
 * fewer than MIN_VISION_FRAMES frames, so callers should wrap this in
 * try/catch — but see MIN_VISION_FRAMES above for why that specific case is
 * worth checking for and handling separately rather than lumping into the
 * same catch as a real network failure.
 */
export async function predictVisionForm(
  frames: VisionFrames,
  durationSeconds: number,
  baseUrl: string = DEFAULT_VISION_MODEL_URL,
): Promise<VisionPrediction> {
  if (frames.length < MIN_VISION_FRAMES) {
    throw new Error(`need at least ${MIN_VISION_FRAMES} buffered frames, got ${frames.length}`)
  }
  const res = await fetch(`${baseUrl}/predict/vision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ frames, duration_seconds: durationSeconds }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`vision model API returned ${res.status}${detail ? `: ${detail}` : ''}`)
  }
  return res.json()
}

/**
 * POST a buffered rep to the fused vision+IMU model and return its
 * classification. `flexDrift` supplies the real imu.flex/imu.drift arrays;
 * imu.emg and imu.vib_on are always sent as 0/false placeholders for every
 * sample (see this file's module doc for why). Throws under the same
 * conditions as predictVisionForm, plus if `flexDrift` is empty (the fused
 * endpoint requires non-empty IMU arrays) — callers should check for that
 * themselves first if they want to distinguish it from other failures.
 */
export async function predictFusedForm(
  frames: VisionFrames,
  durationSeconds: number,
  flexDrift: FlexDriftSample[],
  baseUrl: string = DEFAULT_VISION_MODEL_URL,
): Promise<FusedPrediction> {
  if (frames.length < MIN_VISION_FRAMES) {
    throw new Error(`need at least ${MIN_VISION_FRAMES} buffered frames, got ${frames.length}`)
  }
  if (flexDrift.length === 0) {
    throw new Error('need at least 1 buffered flex/drift sample, got 0')
  }
  const res = await fetch(`${baseUrl}/predict`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      vision: { frames, duration_seconds: durationSeconds },
      imu: {
        flex: flexDrift.map((s) => s.flex),
        drift: flexDrift.map((s) => s.drift),
        emg: flexDrift.map(() => 0),
        vib_on: flexDrift.map(() => false),
      },
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`vision model API returned ${res.status}${detail ? `: ${detail}` : ''}`)
  }
  return res.json()
}
