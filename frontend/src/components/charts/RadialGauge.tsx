const START_ANGLE = -135
const END_ANGLE = 135

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, r, endAngle)
  const end = polarToCartesian(cx, cy, r, startAngle)
  const largeArcFlag = endAngle - startAngle <= 180 ? 0 : 1
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`
}

function mapToAngle(value: number, min: number, max: number) {
  const clamped = Math.max(min, Math.min(max, value))
  return START_ANGLE + ((clamped - min) / (max - min)) * (END_ANGLE - START_ANGLE)
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
  const inTarget = value >= targetMin && value <= targetMax && !fault

  const valueColor = fault ? 'var(--color-crimson)' : inTarget ? 'var(--color-emerald)' : 'var(--color-accent)'

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <path
          d={describeArc(cx, cy, r, START_ANGLE, END_ANGLE)}
          fill="none"
          stroke="var(--color-border)"
          strokeWidth={14}
          strokeLinecap="round"
        />
        <path
          d={describeArc(cx, cy, r, mapToAngle(targetMin, min, max), mapToAngle(targetMax, min, max))}
          fill="none"
          stroke="var(--color-emerald)"
          strokeOpacity={0.25}
          strokeWidth={14}
          strokeLinecap="round"
        />
        <path
          d={describeArc(cx, cy, r, START_ANGLE, mapToAngle(value, min, max))}
          fill="none"
          stroke={valueColor}
          strokeWidth={14}
          strokeLinecap="round"
          style={{ transition: 'all 200ms ease-out' }}
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
