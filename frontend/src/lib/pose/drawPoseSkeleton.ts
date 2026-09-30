import { PoseLandmarker } from '@mediapipe/tasks-vision'
import type { Landmark, Side } from './poseMetrics'

const IDX = {
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
}

// Fixed (theme-independent) palette: this draws on the camera viewport's
// permanently dark backdrop, so it uses the same vivid tones in both themes.
const EMERALD = '#32d74b'
const CRIMSON = '#ff453a'
const NEUTRAL = '#0a84ff'

function armConnections(side: 'left' | 'right') {
  const shoulder = side === 'left' ? IDX.LEFT_SHOULDER : IDX.RIGHT_SHOULDER
  const elbow = side === 'left' ? IDX.LEFT_ELBOW : IDX.RIGHT_ELBOW
  const wrist = side === 'left' ? IDX.LEFT_WRIST : IDX.RIGHT_WRIST
  return new Set([`${shoulder}-${elbow}`, `${elbow}-${shoulder}`, `${elbow}-${wrist}`, `${wrist}-${elbow}`])
}

const TORSO_CONNECTIONS = new Set([`${IDX.LEFT_SHOULDER}-${IDX.RIGHT_SHOULDER}`, `${IDX.RIGHT_SHOULDER}-${IDX.LEFT_SHOULDER}`])

const ARM_POINTS: Record<'left' | 'right', number[]> = {
  left: [IDX.LEFT_SHOULDER, IDX.LEFT_ELBOW, IDX.LEFT_WRIST],
  right: [IDX.RIGHT_SHOULDER, IDX.RIGHT_ELBOW, IDX.RIGHT_WRIST],
}

/**
 * Draws the detected 33-landmark skeleton onto a 2D canvas context, upper
 * body only — a bicep curl is filmed waist-up on a typical desk/webcam
 * setup, so the legs/hips/ankles an earlier squat-era version drew here
 * were both irrelevant and unreliable (MediaPipe still estimates positions
 * for landmarks that are off-screen or occluded below the frame, and those
 * estimates can swing wildly since there's no real leg to track — the
 * visible symptom was skeleton lines shooting off in odd directions). The
 * curling arm turns crimson while a fault is active, the reference arm and
 * shoulder line stay emerald, everything else (face) is neutral electric-blue.
 */
export function drawPoseSkeleton(
  ctx: CanvasRenderingContext2D,
  landmarks: Landmark[],
  opts: { width: number; height: number; monitoredSide: Side; faultActive: boolean },
) {
  const { width, height, monitoredSide, faultActive } = opts
  const referenceSide: Side = monitoredSide === 'left' ? 'right' : 'left'
  const monitoredSet = armConnections(monitoredSide)
  const monitoredColor = faultActive ? CRIMSON : EMERALD

  ctx.clearRect(0, 0, width, height)

  const point = (i: number) => {
    const lm = landmarks[i]
    return lm ? { x: lm.x * width, y: lm.y * height, visibility: lm.visibility ?? 1 } : null
  }

  const colorFor = (a: number, b: number) => {
    const key = `${a}-${b}`
    if (monitoredSet.has(key)) return monitoredColor
    if (TORSO_CONNECTIONS.has(key)) return EMERALD
    return NEUTRAL
  }

  // Only draw connections between two points both above the shoulder line's
  // downward extent by a generous margin, or between the shoulder/arm/face
  // points themselves — skips MediaPipe's full-body POSE_CONNECTIONS set
  // (which includes legs) without needing a second, separately-maintained
  // connection list here.
  const UPPER_BODY_INDICES = new Set([
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, // face
    IDX.LEFT_SHOULDER,
    IDX.RIGHT_SHOULDER,
    IDX.LEFT_ELBOW,
    IDX.RIGHT_ELBOW,
    IDX.LEFT_WRIST,
    IDX.RIGHT_WRIST,
  ])

  ctx.lineCap = 'round'
  for (const { start, end } of PoseLandmarker.POSE_CONNECTIONS) {
    if (!UPPER_BODY_INDICES.has(start) || !UPPER_BODY_INDICES.has(end)) continue
    const a = point(start)
    const b = point(end)
    if (!a || !b || a.visibility < 0.4 || b.visibility < 0.4) continue
    const color = colorFor(start, end)
    ctx.strokeStyle = color
    ctx.lineWidth = color === monitoredColor && faultActive ? 4.5 : 3
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  }
  // The shoulder line isn't part of MediaPipe's own POSE_CONNECTIONS set, so
  // draw it explicitly rather than trying to coax it out of the filter above.
  const lShoulder = point(IDX.LEFT_SHOULDER)
  const rShoulder = point(IDX.RIGHT_SHOULDER)
  if (lShoulder && rShoulder && lShoulder.visibility >= 0.4 && rShoulder.visibility >= 0.4) {
    ctx.strokeStyle = EMERALD
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(lShoulder.x, lShoulder.y)
    ctx.lineTo(rShoulder.x, rShoulder.y)
    ctx.stroke()
  }

  const dotColorFor = (i: number) => {
    if (ARM_POINTS[monitoredSide].includes(i)) return monitoredColor
    if (ARM_POINTS[referenceSide].includes(i)) return EMERALD
    return NEUTRAL
  }

  for (const i of UPPER_BODY_INDICES) {
    const p = point(i)
    if (!p || p.visibility < 0.4) continue
    const color = dotColorFor(i)
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2)
    ctx.fill()
  }
}
