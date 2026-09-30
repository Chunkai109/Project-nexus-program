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
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
} as const

const VISIBILITY_MIN = 0.5

function isVisible(p?: Landmark): p is Landmark {
  return !!p && (p.visibility ?? 1) >= VISIBILITY_MIN
}

export type Side = 'left' | 'right'

/**
 * Whether the curling arm's shoulder, elbow and wrist are all confidently
 * visible — the framing this app actually needs for a bicep curl (waist-up
 * is fine; hips/knees/ankles, which an earlier squat-era version checked
 * here, are irrelevant to this exercise and were never in frame for a
 * typical desk/webcam bicep curl setup anyway).
 */
export function isArmVisible(landmarks: Landmark[], side: Side): boolean {
  const shoulder = landmarks[side === 'left' ? POSE_LANDMARK.LEFT_SHOULDER : POSE_LANDMARK.RIGHT_SHOULDER]
  const elbow = landmarks[side === 'left' ? POSE_LANDMARK.LEFT_ELBOW : POSE_LANDMARK.RIGHT_ELBOW]
  const wrist = landmarks[side === 'left' ? POSE_LANDMARK.LEFT_WRIST : POSE_LANDMARK.RIGHT_WRIST]
  return isVisible(shoulder) && isVisible(elbow) && isVisible(wrist)
}
