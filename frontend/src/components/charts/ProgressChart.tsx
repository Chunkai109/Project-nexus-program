import { CartesianGrid, LabelList, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { SessionStats } from '@/lib/sessionStats'

const SERIES = [
  { key: 'goodFormPct', label: 'Good form', color: 'var(--color-emerald)' },
  { key: 'inRangePct', label: 'In range', color: 'var(--color-accent)' },
] as const

function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** Good-form % and in-range % per session, one dot per session, each line labelled at its end. */
export function ProgressChart({ stats, height = 240 }: { stats: SessionStats[]; height?: number }) {
  const data = stats.map((s) => ({
    label: shortDate(s.session.completedAt),
    exercise: s.session.exerciseTitle,
    goodFormPct: s.goodFormPct,
    scored: s.aiScored,
    unscored: s.unscored,
    inRangePct: s.inRangePct,
  }))

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 12, right: 100, bottom: 4, left: -4 }}>
        <CartesianGrid stroke="var(--color-border)" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fill: 'var(--color-ink-faint)', fontSize: 11 }}
          axisLine={{ stroke: 'var(--color-border-strong)' }}
          tickLine={false}
        />
        <YAxis
          domain={[0, 100]}
          ticks={[0, 25, 50, 75, 100]}
          tickFormatter={(v: number) => `${v}%`}
          tick={{ fill: 'var(--color-ink-faint)', fontSize: 11 }}
          axisLine={{ stroke: 'var(--color-border-strong)' }}
          tickLine={false}
          width={48}
        />
        <Tooltip
          contentStyle={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 12,
            fontSize: 12,
            color: 'var(--color-ink)',
          }}
          labelFormatter={(label, items) => {
            const exercise = (items?.[0]?.payload as { exercise?: string } | undefined)?.exercise
            return exercise ? `${label} · ${exercise}` : String(label)
          }}
          formatter={(value, name, item) => {
            if (name !== 'Good form') return [`${value}%`, name]
            const p = item.payload as { scored: number; unscored: number }
            const basis = `Based on ${p.scored} scored reps · ${p.unscored} not scored`
            return [value == null ? `No AI verdicts (${basis})` : `${value}% (${basis})`, name]
          }}
        />
        {SERIES.map((s) => (
          <Line
            key={s.key}
            type="linear"
            dataKey={s.key}
            name={s.label}
            stroke={s.color}
            strokeWidth={2.5}
            dot={{ r: 3.5, fill: s.color, strokeWidth: 0 }}
            connectNulls
            isAnimationActive={false}
          >
            <LabelList
              dataKey={s.key}
              content={(props) => {
                const { x, y, value, index } = props as { x?: number; y?: number; value?: number | null; index?: number }
                if (index !== data.length - 1 || x == null || y == null || value == null) return null
                // Push the two end labels apart when the lines finish close together.
                const other = SERIES.find((o) => o.key !== s.key)!
                const otherValue = data[data.length - 1][other.key]
                const close = otherValue != null && Math.abs(value - otherValue) < 8
                const shift = !close ? 0 : value > otherValue || (value === otherValue && s.key === 'inRangePct') ? -8 : 8
                return (
                  <text x={Number(x) + 10} y={Number(y) + shift} dy="0.35em" fontSize={12} fontWeight={600} fill={s.color}>
                    {s.label} {value}%
                  </text>
                )
              }}
            />
          </Line>
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}
