import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { TelemetryPoint } from '@/types'

export function TrendChart({ data, height = 260 }: { data: TelemetryPoint[]; height?: number }) {
  const chartData = data.map((d) => ({ ...d, bandHeight: d.targetMax - d.targetMin }))

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
        <CartesianGrid stroke="var(--color-border)" vertical={false} />
        <XAxis
          dataKey="t"
          tick={{ fill: 'var(--color-ink-faint)', fontSize: 11 }}
          axisLine={{ stroke: 'var(--color-border-strong)' }}
          tickLine={false}
          interval={4}
          label={{ value: 'Rep sequence', position: 'insideBottom', offset: -2, fill: 'var(--color-ink-faint)', fontSize: 11 }}
        />
        <YAxis
          tick={{ fill: 'var(--color-ink-faint)', fontSize: 11 }}
          axisLine={{ stroke: 'var(--color-border-strong)' }}
          tickLine={false}
          width={40}
          domain={[60, 140]}
          ticks={[60, 80, 100, 120, 140]}
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
        />
        <Area dataKey="targetMin" stackId="band" fill="transparent" stroke="none" isAnimationActive={false} />
        <Area
          dataKey="bandHeight"
          stackId="band"
          fill="var(--color-emerald)"
          fillOpacity={0.12}
          stroke="var(--color-emerald)"
          strokeOpacity={0.3}
          strokeWidth={1}
          isAnimationActive={false}
          name="Target corridor"
        />
        <Line
          type="monotone"
          dataKey="angle"
          stroke="var(--color-accent)"
          strokeWidth={2.5}
          dot={false}
          isAnimationActive={false}
          name="Joint angle"
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
