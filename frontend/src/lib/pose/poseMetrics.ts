export interface Landmark {
  x: number
  y: number
  z: number
  visibility?: number
}

// Subset of the MediaPipe Pose Landmarker's 33-point index layout used here.
export const POSE_LANDMARK = {
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
} as const

const VISIBILITY_MIN = 0.5

function isVisible(p?: Landmark): p is Landmark {
  return !!p && (p.visibility ?? 1) >= VISIBILITY_MIN
}

/** Interior angle at vertex b formed by rays b->a and b->c, in degrees. Uses image-plane (x, y) only. */
function angleAtVertex(a: Landmark, b: Landmark, c: Landmark): number {
  const abx = a.x - b.x
  const aby = a.y - b.y
  const cbx = c.x - b.x
  const cby = c.y - b.y
  const magAB = Math.hypot(abx, aby)
  const magCB = Math.hypot(cbx, cby)
  if (magAB === 0 || magCB === 0) return NaN
  const cos = Math.max(-1, Math.min(1, (abx * cbx + aby * cby) / (magAB * magCB)))
  return (Math.acos(cos) * 180) / Math.PI
}

export type Side = 'left' | 'right'

export interface KneeReading {
  /** Interior hip-knee-ankle angle in degrees (180 = straight leg). */
  flexionDeg: number
  /**
   * Signed medial (valgus-positive) deviation of the knee from the
   * hip-ankle line, normalized by leg length and rescaled to a
   * degree-like number for display. This is a 2D frontal-plane
   * approximation, not a true 3D joint angle — a single camera can't
   * fully separate valgus from normal forward knee travel during a
   * squat, which is exactly why the proposal pairs vision with IMU
   * pods for localized limb rotation. Good enough to flag gross
   * frontal-plane collapse, not a clinical goniometer replacement.
   */
  valgusDeg: number
}

/** Computes a knee reading for one side, or null if the needed landmarks aren't confidently visible. */
export function computeKneeReading(landmarks: Landmark[], side: Side): KneeReading | null {
  const hip = landmarks[side === 'left' ? POSE_LANDMARK.LEFT_HIP : POSE_LANDMARK.RIGHT_HIP]
  const knee = landmarks[side === 'left' ? POSE_LANDMARK.LEFT_KNEE : POSE_LANDMARK.RIGHT_KNEE]
  const ankle = landmarks[side === 'left' ? POSE_LANDMARK.LEFT_ANKLE : POSE_LANDMARK.RIGHT_ANKLE]
  const otherHip = landmarks[side === 'left' ? POSE_LANDMARK.RIGHT_HIP : POSE_LANDMARK.LEFT_HIP]

  if (!isVisible(hip) || !isVisible(knee) || !isVisible(ankle) || !isVisible(otherHip)) return null

  const flexionDeg = angleAtVertex(hip, knee, ankle)
  if (Number.isNaN(flexionDeg)) return null

  const legLength = Math.hypot(hip.x - ankle.x, hip.y - ankle.y)
  if (legLength < 1e-4) return null

  const expectedKneeX = (hip.x + ankle.x) / 2
  const rawDeviation = knee.x - expectedKneeX
  // "Inward" means toward the other hip, whichever side of the frame that
  // is — so a positive result always means valgus regardless of which way
  // the patient is facing the camera.
  const inwardSign = otherHip.x > hip.x ? 1 : -1
  const normalizedDeviation = (rawDeviation * inwardSign) / legLength

  const VALGUS_SCALE = 70
  const valgusDeg = normalizedDeviation * VALGUS_SCALE

  return { flexionDeg, valgusDeg }
}
