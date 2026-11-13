/**
 * Good-form % across a patient's last sessions of one exercise, drawn as a
 * small accent line on a fixed 0–100 scale. Sessions the AI did not score
 * are skipped. Below two scored points it says so in words.
 */
export function Sparkline({ values, width = 80, height = 24, label }: { values: (number | null)[]; width?: number; height?: number; label: string }) {
  const points = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null)
  if (points.length < 2) return <span className="text-[13px] text-ink-muted">Not enough sessions</span>
  const step = values.length > 1 ? (width - 4) / (values.length - 1) : 0
  const y = (v: number) => 2 + (height - 4) * (1 - v / 100)
  const d = points.map((p, k) => `${k === 0 ? 'M' : 'L'}${(2 + p.i * step).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')
  const last = points[points.length - 1]
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="block overflow-visible">
      <title>{label}</title>
      <line x1={0} x2={width} y1={y(50)} y2={y(50)} stroke="var(--color-border)" strokeWidth={1} />
      <path d={d} fill="none" stroke="var(--color-accent)" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={2 + last.i * step} cy={y(last.v)} r={2.5} fill="var(--color-accent)" />
    </svg>
  )
}
