const START_ANGLE = -135
const END_ANGLE = 135
const TOTAL_SWEEP = END_ANGLE - START_ANGLE

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

/**
 * The gauge's single 270° arc path — constant for a given (cx, cy, r), never
 * recomputed per value. The value and target-zone overlays below reveal a
 * portion of this SAME fixed path via stroke-dasharray/stroke-dashoffset
 * instead of each having their own dynamically-computed `d`.
 *
 * An earlier version gave the value arc its own `d` (recomputed every
 * render to sweep from START_ANGLE to the current value's angle) with a
 * CSS transition on it for a smooth animated fill. That doesn't work: an
 * SVG arc's large-arc-flag flips exactly at the arc's angular midpoint (here,
 * whenever the value crosses roughly 2/3 of the way from min to max), and
 * browsers can't sanely interpolate a path's `d` string across that flip —
 * the visible symptom was the arc briefly rendering as a wildly wrong shape
 * that appeared to shoot outside the gauge's own circle on a fast value
 * change (exactly the range a rep's flexion sweeps through on every curl).
 * stroke-dasharray/stroke-dashoffset are plain numbers, which CSS always
 * interpolates correctly regardless of how much of the arc is revealed.
 */
function fullArcPath(cx: number, cy: number, r: number): string {
  const start = polarToCartesian(cx, cy, r, START_ANGLE)
  const end = polarToCartesian(cx, cy, r, END_ANGLE)
  return `M ${start.x} ${start.y} A ${r} ${r} 0 1 1 ${end.x} ${end.y}`
}

function mapToAngle(value: number, min: number, max: number) {
  const clamped = Math.max(min, Math.min(max, value))
  return START_ANGLE + ((clamped - min) / (max - min)) * TOTAL_SWEEP
}

/** dasharray/dashoffset that reveals only the [fromAngle, toAngle] slice of the fixed fullArcPath. The gap is deliberately much longer than the arc itself so the dash pattern never repeats a second time around. */
function arcReveal(arcLength: number, fromAngle: number, toAngle: number) {
  const distanceTo = (angle: number) => (arcLength * (angle - START_ANGLE)) / TOTAL_SWEEP
  const start = distanceTo(fromAngle)
  const segment = Math.max(0, distanceTo(toAngle) - start)
  return { dasharray: `${segment} ${arcLength * 2}`, dashoffset: -start }
}

export function RadialGauge({
  value,
  min = 0,
  max = 150,
  targetMin,
  targetMax,
  unit = '°',
  label,
  fault = false,
  size = 220,
}: {
  value: number
  min?: number
  max?: number
  targetMin: number
  targetMax: number
  unit?: string
  label: string
  fault?: boolean
  size?: number
}) {
  const cx = size / 2
  const cy = size / 2
  const r = size / 2 - 18
  const arcLength = (r * TOTAL_SWEEP * Math.PI) / 180
  const path = fullArcPath(cx, cy, r)
  const inTarget = value >= targetMin && value <= targetMax && !fault

  const valueColor = fault ? 'var(--color-crimson)' : inTarget ? 'var(--color-emerald)' : 'var(--color-accent)'

  const valueReveal = arcReveal(arcLength, START_ANGLE, mapToAngle(value, min, max))
  const targetReveal = arcReveal(arcLength, mapToAngle(targetMin, min, max), mapToAngle(targetMax, min, max))

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <path d={path} fill="none" stroke="var(--color-border)" strokeWidth={14} strokeLinecap="round" />
        <path
          d={path}
          fill="none"
          stroke="var(--color-emerald)"
          strokeOpacity={0.25}
          strokeWidth={14}
          strokeLinecap="round"
          strokeDasharray={targetReveal.dasharray}
          strokeDashoffset={targetReveal.dashoffset}
        />
        <path
          d={path}
          fill="none"
          stroke={valueColor}
          strokeWidth={14}
          strokeLinecap="round"
          strokeDasharray={valueReveal.dasharray}
          strokeDashoffset={valueReveal.dashoffset}
          style={{ transition: 'stroke-dashoffset 200ms ease-out, stroke-dasharray 200ms ease-out, stroke 200ms ease-out' }}
        />
        <text
          x={cx}
          y={cy - 6}
          textAnchor="middle"
          className="fill-ink"
          style={{ fontSize: 40, fontWeight: 600, letterSpacing: '-0.02em', transition: 'all 200ms ease-out' }}
        >
          {Math.round(value)}
          <tspan style={{ fontSize: 20, fill: 'var(--color-ink-muted)' }}>{unit}</tspan>
        </text>
        <text x={cx} y={cy + 20} textAnchor="middle" className="fill-ink-muted" style={{ fontSize: 12 }}>
          Target {targetMin}°–{targetMax}°
        </text>
      </svg>
      <p className="-mt-1 text-sm font-medium text-ink-muted">{label}</p>
    </div>
  )
}
