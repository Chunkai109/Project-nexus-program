import { PoseLandmarker } from '@mediapipe/tasks-vision'
import type { Landmark, Side } from './poseMetrics'

const IDX = {
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_HEEL: 29,
  RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31,
  RIGHT_FOOT_INDEX: 32,
}

// Fixed (theme-independent) palette: this draws on the camera viewport's
// permanently dark backdrop, so it uses the same vivid tones in both themes.
const EMERALD = '#32d74b'
const CRIMSON = '#ff453a'
const NEUTRAL = '#0a84ff'

function legConnections(side: 'left' | 'right') {
  const hip = side === 'left' ? IDX.LEFT_HIP : IDX.RIGHT_HIP
  const knee = side === 'left' ? IDX.LEFT_KNEE : IDX.RIGHT_KNEE
  const ankle = side === 'left' ? IDX.LEFT_ANKLE : IDX.RIGHT_ANKLE
  const heel = side === 'left' ? IDX.LEFT_HEEL : IDX.RIGHT_HEEL
  const footIndex = side === 'left' ? IDX.LEFT_FOOT_INDEX : IDX.RIGHT_FOOT_INDEX
  return new Set([
    `${hip}-${knee}`,
    `${knee}-${hip}`,
    `${knee}-${ankle}`,
    `${ankle}-${knee}`,
    `${ankle}-${heel}`,
    `${heel}-${ankle}`,
    `${ankle}-${footIndex}`,
    `${footIndex}-${ankle}`,
    `${heel}-${footIndex}`,
    `${footIndex}-${heel}`,
  ])
}

const TORSO_CONNECTIONS = new Set([
  `${IDX.LEFT_SHOULDER}-${IDX.RIGHT_SHOULDER}`,
  `${IDX.RIGHT_SHOULDER}-${IDX.LEFT_SHOULDER}`,
  `${IDX.LEFT_HIP}-${IDX.RIGHT_HIP}`,
  `${IDX.RIGHT_HIP}-${IDX.LEFT_HIP}`,
  `${IDX.LEFT_SHOULDER}-${IDX.LEFT_HIP}`,
  `${IDX.LEFT_HIP}-${IDX.LEFT_SHOULDER}`,
  `${IDX.RIGHT_SHOULDER}-${IDX.RIGHT_HIP}`,
  `${IDX.RIGHT_HIP}-${IDX.RIGHT_SHOULDER}`,
])

const LEG_POINTS: Record<'left' | 'right', number[]> = {
  left: [IDX.LEFT_HIP, IDX.LEFT_KNEE, IDX.LEFT_ANKLE, IDX.LEFT_HEEL, IDX.LEFT_FOOT_INDEX],
  right: [IDX.RIGHT_HIP, IDX.RIGHT_KNEE, IDX.RIGHT_ANKLE, IDX.RIGHT_HEEL, IDX.RIGHT_FOOT_INDEX],
}

/**
 * Draws the detected 33-landmark skeleton onto a 2D canvas context, colored
 * per the same convention as the simulated overlay: the monitored leg turns
 * crimson while a fault is active, the reference leg and torso stay emerald,
 * everything else (arms, face) is neutral electric-blue.
 */
export function drawPoseSkeleton(
  ctx: CanvasRenderingContext2D,
  landmarks: Landmark[],
  opts: { width: number; height: number; monitoredSide: Side; faultActive: boolean },
) {
  const { width, height, monitoredSide, faultActive } = opts
  const referenceSide: Side = monitoredSide === 'left' ? 'right' : 'left'
  const monitoredSet = legConnections(monitoredSide)
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

  ctx.lineCap = 'round'
  for (const { start, end } of PoseLandmarker.POSE_CONNECTIONS) {
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

  const dotColorFor = (i: number) => {
    if (LEG_POINTS[monitoredSide].includes(i)) return monitoredColor
    if (LEG_POINTS[referenceSide].includes(i)) return EMERALD
    return NEUTRAL
  }

  for (let i = 0; i < landmarks.length; i++) {
    const p = point(i)
    if (!p || p.visibility < 0.4) continue
    const color = dotColorFor(i)
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2)
    ctx.fill()
  }
}
