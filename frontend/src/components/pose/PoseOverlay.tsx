/**
 * Simplified skeletal rig standing in for a Google MediaPipe Pose (33-landmark)
 * inference result. This draft has no model wired to the camera feed yet — the
 * joint positions below are driven by the same simulated squat-depth signal
 * that powers the knee-flexion gauge, so the overlay stays visually in sync
 * with the mocked sensor stream until real MediaPipe inference replaces it.
 */
interface Point {
  x: number
  y: number
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

export function PoseOverlay({
  squatDepth,
  faultActive,
  faultDeg,
}: {
  squatDepth: number
  faultActive: boolean
  faultDeg: number
}) {
  const cx = 320
  const hipY = lerp(150, 214, squatDepth)
  const kneeY = lerp(232, 252, squatDepth)
  const ankleY = 322
  const shoulderY = hipY - 92
  const headY = shoulderY - 34

  const valgusShift = faultActive ? Math.min(34, faultDeg * 1.8) : 0

  const nose: Point = { x: cx, y: headY - 14 }
  const lEye: Point = { x: cx - 5, y: headY - 17 }
  const rEye: Point = { x: cx + 5, y: headY - 17 }
  const lEar: Point = { x: cx - 10, y: headY - 14 }
  const rEar: Point = { x: cx + 10, y: headY - 14 }

  const lShoulder: Point = { x: cx - 30, y: shoulderY }
  const rShoulder: Point = { x: cx + 30, y: shoulderY }
  const lElbow: Point = { x: cx - 40, y: shoulderY + 40 }
  const rElbow: Point = { x: cx + 40, y: shoulderY + 40 }
  const lWrist: Point = { x: cx - 44, y: shoulderY + 78 }
  const rWrist: Point = { x: cx + 44, y: shoulderY + 78 }

  const lHip: Point = { x: cx - 19, y: hipY }
  const rHip: Point = { x: cx + 19, y: hipY }
  const lKnee: Point = { x: cx - 22, y: kneeY }
  const rKnee: Point = { x: cx + 22 - valgusShift, y: kneeY }
  const lAnkle: Point = { x: cx - 24, y: ankleY }
  const rAnkle: Point = { x: cx + 24, y: ankleY }
  const lFoot: Point = { x: cx - 34, y: ankleY + 12 }
  const rFoot: Point = { x: cx + 34, y: ankleY + 12 }

  const hipMid: Point = { x: cx, y: hipY }
  const shoulderMid: Point = { x: cx, y: shoulderY }

  const EMERALD = '#10b981'
  const CRIMSON = '#ef4444'
  const NEUTRAL = '#38bdf8'

  const rightLegColor = faultActive ? CRIMSON : EMERALD

  const seg = (p1: Point, p2: Point, color: string, width = 3, glow = true) => (
    <line
      x1={p1.x}
      y1={p1.y}
      x2={p2.x}
      y2={p2.y}
      stroke={color}
      strokeWidth={width}
      strokeLinecap="round"
      style={glow ? { filter: `drop-shadow(0 0 5px ${color})` } : undefined}
    />
  )

  const dot = (p: Point, color: string, r = 3.2) => (
    <circle cx={p.x} cy={p.y} r={r} fill={color} style={{ filter: `drop-shadow(0 0 4px ${color})` }} />
  )

  const allPoints: [Point, string][] = [
    [nose, NEUTRAL],
    [lEye, NEUTRAL],
    [rEye, NEUTRAL],
    [lEar, NEUTRAL],
    [rEar, NEUTRAL],
    [lShoulder, EMERALD],
    [rShoulder, NEUTRAL],
    [lElbow, EMERALD],
    [rElbow, NEUTRAL],
    [lWrist, EMERALD],
    [rWrist, NEUTRAL],
    [lHip, EMERALD],
    [rHip, rightLegColor],
    [lKnee, EMERALD],
    [rKnee, rightLegColor],
    [lAnkle, EMERALD],
    [rAnkle, rightLegColor],
    [lFoot, EMERALD],
    [rFoot, rightLegColor],
  ]

  return (
    <svg viewBox="0 0 640 360" className="pointer-events-none absolute inset-0 h-full w-full">
      {/* face */}
      {seg(lEar, lEye, NEUTRAL, 1.5, false)}
      {seg(rEar, rEye, NEUTRAL, 1.5, false)}
      {seg(lEye, nose, NEUTRAL, 1.5, false)}
      {seg(rEye, nose, NEUTRAL, 1.5, false)}

      {/* torso / spine — always assessed as correct form */}
      {seg(shoulderMid, hipMid, EMERALD, 4)}
      {seg(lShoulder, rShoulder, EMERALD, 3)}
      {seg(lHip, rHip, EMERALD, 3)}

      {/* arms — tracked, not assessed */}
      {seg(lShoulder, lElbow, EMERALD, 3)}
      {seg(lElbow, lWrist, EMERALD, 3)}
      {seg(rShoulder, rElbow, NEUTRAL, 3)}
      {seg(rElbow, rWrist, NEUTRAL, 3)}

      {/* left leg — reference / correct form */}
      {seg(lHip, lKnee, EMERALD, 4)}
      {seg(lKnee, lAnkle, EMERALD, 4)}
      {seg(lAnkle, lFoot, EMERALD, 3)}

      {/* right leg — fault-monitored segment */}
      {seg(rHip, rKnee, rightLegColor, faultActive ? 5 : 4)}
      {seg(rKnee, rAnkle, rightLegColor, faultActive ? 5 : 4)}
      {seg(rAnkle, rFoot, rightLegColor, 3)}

      {allPoints.map(([p, c], i) => (
        <g key={i}>{dot(p, c)}</g>
      ))}
    </svg>
  )
}
