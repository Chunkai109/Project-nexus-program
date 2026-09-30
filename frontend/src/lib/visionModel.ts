/**
 * Client for the bicep-curl vision model's fusion API
 * (`ensemble/api/server.py`) — specifically its vision-only endpoint,
 * `POST /predict/vision`. That API is a separate local Python process (like
 * the ESP32 hub is separate hardware); this module just calls it over HTTP
 * and never assumes it's running.
 *
 * Only the vision-only endpoint is used here, not the fused `/predict` one:
 * fusing in IMU data would mean inventing `flex`/`drift`/`emg`/`vib_on`
 * arrays for sessions with no wearable connected, which is exactly the
 * fabricated-sensor-data pattern `ensemble/README.md` rules out. Camera-only
 * pose classification doesn't have that problem — see
 * `ensemble/FRONTEND_INTEGRATION.md` Section 5.
 */

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
