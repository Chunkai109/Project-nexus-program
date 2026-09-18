import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { SymmetryPoint } from '@/types'

export function SymmetryBarChart({ data, height = 240 }: { data: SymmetryPoint[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }} barGap={4}>
        <CartesianGrid stroke="var(--color-border)" vertical={false} />
        <XAxis
          dataKey="session"
          tick={{ fill: 'var(--color-ink-faint)', fontSize: 11 }}
          axisLine={{ stroke: 'var(--color-border-strong)' }}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: 'var(--color-ink-faint)', fontSize: 11 }}
          axisLine={{ stroke: 'var(--color-border-strong)' }}
          tickLine={false}
          width={46}
          domain={[0, 100]}
          ticks={[0, 25, 50, 75, 100]}
          tickFormatter={(v) => `${v}%`}
        />
        <Tooltip
          contentStyle={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 12,
            fontSize: 12,
            color: 'var(--color-ink)',
            boxShadow: 'var(--shadow-ambient)',
          }}
          labelStyle={{ color: 'var(--color-ink-muted)' }}
          cursor={{ fill: 'var(--color-surface-secondary)' }}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: 'var(--color-ink-muted)' }} />
        <Bar dataKey="left" name="Left Limb" fill="var(--color-accent)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
        <Bar dataKey="right" name="Right Limb" fill="var(--color-emerald)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  )
}
