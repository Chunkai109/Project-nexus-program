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
        <CartesianGrid stroke="#334155" strokeOpacity={0.4} vertical={false} />
        <XAxis
          dataKey="t"
          tick={{ fill: '#64748b', fontSize: 11 }}
          axisLine={{ stroke: '#334155' }}
          tickLine={false}
          interval={4}
          label={{ value: 'Rep sequence', position: 'insideBottom', offset: -2, fill: '#64748b', fontSize: 11 }}
        />
        <YAxis
          tick={{ fill: '#64748b', fontSize: 11 }}
          axisLine={{ stroke: '#334155' }}
          tickLine={false}
          width={40}
          domain={[60, 140]}
          ticks={[60, 80, 100, 120, 140]}
        />
        <Tooltip
          contentStyle={{
            background: '#1e293b',
            border: '1px solid #334155',
            borderRadius: 10,
            fontSize: 12,
            color: '#f1f5f9',
          }}
          labelStyle={{ color: '#94a3b8' }}
        />
        <Area dataKey="targetMin" stackId="band" fill="transparent" stroke="none" isAnimationActive={false} />
        <Area
          dataKey="bandHeight"
          stackId="band"
          fill="#10b981"
          fillOpacity={0.14}
          stroke="#10b981"
          strokeOpacity={0.3}
          strokeWidth={1}
          isAnimationActive={false}
          name="Target corridor"
        />
        <Line
          type="monotone"
          dataKey="angle"
          stroke="#38bdf8"
          strokeWidth={2.5}
          dot={false}
          isAnimationActive={false}
          name="Joint angle"
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
