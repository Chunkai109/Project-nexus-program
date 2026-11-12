import type { ReactNode } from 'react'
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { aiClassOf } from '@/lib/sessionStats'
import type { RepSample } from '@/types'

interface RepPoint {
  rep: number
  angle: number
  verdict: string | null
  drift: boolean
}

/** Axis from a multiple of 5 with 4 equal steps that are also multiples of 5, e.g. 90°, 105°, 120°… */
function niceAxis(lo: number, hi: number): { min: number; max: number; ticks: number[] } {
  const min = Math.max(0, Math.floor(lo / 5) * 5)
  const step = Math.max(5, Math.ceil((hi - min) / 4 / 5) * 5)
  const ticks = Array.from({ length: 5 }, (_, i) => min + step * i)
  return { min, max: ticks[4], ticks }
}

/** One dot per rep: ✓ green = AI scored Perfect, ✕ red = any other AI verdict, hollow = no AI verdict, ! = drift fault fired. */
function VerdictDot({ cx, cy, payload }: { cx?: number; cy?: number; payload?: RepPoint }) {
  if (cx == null || cy == null || !payload) return null
  const perfect = payload.verdict === 'Perfect'
  const faulted = payload.verdict !== null && !perfect
  const color = perfect ? 'var(--color-emerald)' : faulted ? 'var(--color-crimson)' : 'var(--color-ink-faint)'
  return (
    <g>
      <circle
        cx={cx}
        cy={cy}
        r={7}
        fill={payload.verdict ? color : 'var(--color-surface)'}
        stroke={color}
        strokeWidth={payload.verdict ? 0 : 1.5}
      />
      {payload.verdict && (
        <text x={cx} y={cy} dy="0.35em" textAnchor="middle" fontSize={9} fontWeight={700} fill="var(--color-accent-ink)">
          {perfect ? '✓' : '✕'}
        </text>
      )}
      {payload.drift && (
        <text x={cx} y={cy - 12} textAnchor="middle" fontSize={11} fontWeight={800} fill="var(--color-amber)">
          !
        </text>
      )}
    </g>
  )
}

function LegendItem({ swatch, label }: { swatch: ReactNode; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      {swatch}
      {label}
    </span>
  )
}

export function TrendChart({
  reps,
  targetMin,
  targetMax,
  height = 260,
}: {
  reps: RepSample[]
  targetMin: number
  targetMax: number
  height?: number
}) {
  const data: RepPoint[] = reps.map((r) => ({ rep: r.rep, angle: r.angle, verdict: aiClassOf(r), drift: r.faultActive }))

  const all = [...data.map((d) => d.angle), targetMin, targetMax]
  const lo = Math.min(...all)
  const hi = Math.max(...all)
  const pad = Math.max(4, Math.round((hi - lo) * 0.1))
  const axis = niceAxis(lo - pad, hi + pad)

  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 16, right: 16, bottom: 4, left: -4 }}>
          <CartesianGrid stroke="var(--color-border)" vertical={false} />
          <ReferenceArea
            y1={targetMin}
            y2={targetMax}
            fill="var(--color-emerald)"
            fillOpacity={0.1}
            stroke="var(--color-emerald)"
            strokeOpacity={0.35}
          />
          <XAxis
            dataKey="rep"
            tick={{ fill: 'var(--color-ink-faint)', fontSize: 11 }}
            axisLine={{ stroke: 'var(--color-border-strong)' }}
            tickLine={false}
            interval={Math.max(0, Math.ceil(data.length / 12) - 1)}
            label={{ value: 'Rep', position: 'insideBottom', offset: -2, fill: 'var(--color-ink-faint)', fontSize: 11 }}
          />
          <YAxis
            tick={{ fill: 'var(--color-ink-faint)', fontSize: 11 }}
            axisLine={{ stroke: 'var(--color-border-strong)' }}
            tickLine={false}
            width={48}
            domain={[axis.min, axis.max]}
            ticks={axis.ticks}
            tickFormatter={(v: number) => `${v}°`}
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
            labelFormatter={(rep) => `Rep ${rep}`}
            formatter={(value, _name, item) => {
              const p = item.payload as RepPoint
              const verdict = p.verdict ?? 'No AI verdict'
              return [`${value}° · ${verdict}${p.drift ? ' · drift fault' : ''}`, 'Peak angle']
            }}
          />
          <Line
            type="linear"
            dataKey="angle"
            stroke="var(--color-accent)"
            strokeOpacity={0.5}
            strokeWidth={1.5}
            dot={(props: { cx?: number; cy?: number; payload?: RepPoint; index?: number }) => (
              <VerdictDot key={`rep-dot-${props.index}`} cx={props.cx} cy={props.cy} payload={props.payload} />
            )}
            activeDot={false}
            isAnimationActive={false}
            name="Peak angle"
          />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-ink-faint">
        <LegendItem
          swatch={<span className="h-3 w-5 rounded-sm border border-emerald/40 bg-emerald/15" />}
          label={`Target range ${targetMin}–${targetMax}°`}
        />
        <LegendItem
          swatch={<span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald text-[8px] font-bold text-accent-ink">✓</span>}
          label="AI: Perfect"
        />
        <LegendItem
          swatch={<span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-crimson text-[8px] font-bold text-accent-ink">✕</span>}
          label="AI: form fault"
        />
        <LegendItem swatch={<span className="h-3.5 w-3.5 rounded-full border-[1.5px] border-ink-faint" />} label="No AI verdict" />
        <LegendItem swatch={<span className="w-3.5 text-center text-[13px] font-extrabold text-amber-ink">!</span>} label="Upper-arm drift" />
      </div>
    </div>
  )
}
