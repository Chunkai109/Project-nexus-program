import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { RepSample } from '@/types'

/** Peak muscle activation in each rep (0-100%), with the session average as a dashed line (the card's text names it). */
export function MuscleActivationChart({ reps, height = 220 }: { reps: RepSample[]; height?: number }) {
  const data = reps.map((r) => ({ rep: r.rep, pct: Math.round(r.emgLeft) }))
  const avg = data.length ? Math.round(data.reduce((sum, d) => sum + d.pct, 0) / data.length) : 0
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 16, right: 16, bottom: 4, left: -4 }}>
        <CartesianGrid stroke="var(--color-border)" vertical={false} />
        <XAxis
          dataKey="rep"
          tick={{ fill: 'var(--color-ink-muted)', fontSize: 12 }}
          axisLine={{ stroke: 'var(--color-border-strong)' }}
          tickLine={false}
          interval={Math.max(0, Math.ceil(data.length / 12) - 1)}
          label={{ value: 'Rep', position: 'insideBottom', offset: -2, fill: 'var(--color-ink-muted)', fontSize: 12 }}
        />
        <YAxis
          domain={[0, 100]}
          ticks={[0, 25, 50, 75, 100]}
          tickFormatter={(v: number) => `${v}%`}
          tick={{ fill: 'var(--color-ink-muted)', fontSize: 12 }}
          axisLine={{ stroke: 'var(--color-border-strong)' }}
          tickLine={false}
          width={48}
        />
        <Tooltip
          cursor={{ fill: 'var(--color-surface-secondary)' }}
          contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, fontSize: 13, color: 'var(--color-ink)' }}
          labelFormatter={(rep) => `Rep ${rep}`}
          formatter={(value) => [`${value}%`, 'Muscle activation']}
        />
        <ReferenceLine
          y={avg}
          stroke="var(--color-ink-muted)"
          strokeDasharray="5 4"
        />
        <Bar dataKey="pct" name="Muscle activation" fill="var(--color-accent)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  )
}
