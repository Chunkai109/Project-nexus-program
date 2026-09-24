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

function niceTicks(min: number, max: number): number[] {
  const step = (max - min) / 4
  return Array.from({ length: 5 }, (_, i) => Math.round(min + step * i))
}

export function TrendChart({
  data,
  height = 260,
  domain,
}: {
  data: TelemetryPoint[]
  height?: number
  /** [min, max] for the Y axis. Defaults to padding around the data's own target corridor so it fits any exercise's ROM range, not just knee-sized ones. */
  domain?: [number, number]
}) {
  const chartData = data.map((d) => ({ ...d, bandHeight: d.targetMax - d.targetMin }))

  const [yMin, yMax] = domain ?? (() => {
    const angles = data.map((d) => d.angle)
    const targets = data.flatMap((d) => [d.targetMin, d.targetMax])
    const all = [...angles, ...targets]
    const lo = Math.min(...all)
    const hi = Math.max(...all)
    const pad = Math.max(5, Math.round((hi - lo) * 0.15))
    return [Math.max(0, lo - pad), hi + pad]
  })()

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
        <CartesianGrid stroke="var(--color-border)" vertical={false} />
        <XAxis
          dataKey="t"
          tick={{ fill: 'var(--color-ink-faint)', fontSize: 11 }}
          axisLine={{ stroke: 'var(--color-border-strong)' }}
          tickLine={false}
          interval={Math.max(0, Math.ceil(data.length / 10) - 1)}
          label={{ value: 'Rep sequence', position: 'insideBottom', offset: -2, fill: 'var(--color-ink-faint)', fontSize: 11 }}
        />
        <YAxis
          tick={{ fill: 'var(--color-ink-faint)', fontSize: 11 }}
          axisLine={{ stroke: 'var(--color-border-strong)' }}
          tickLine={false}
          width={40}
          domain={[yMin, yMax]}
          ticks={niceTicks(yMin, yMax)}
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
