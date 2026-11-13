import type { ReactNode } from 'react'
import { Check, X } from 'lucide-react'
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
      {/* Drawn as shapes, not text: a tick for Perfect, a cross for a form fault. */}
      {perfect && <path d={`M${cx - 3.2},${cy} L${cx - 0.8},${cy + 2.6} L${cx + 3.4},${cy - 2.8}`} fill="none" stroke="var(--color-accent-ink)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />}
      {faulted && <path d={`M${cx - 2.6},${cy - 2.6} L${cx + 2.6},${cy + 2.6} M${cx + 2.6},${cy - 2.6} L${cx - 2.6},${cy + 2.6}`} stroke="var(--color-accent-ink)" strokeWidth={1.8} strokeLinecap="round" />}
      {payload.drift && (
        <text x={cx} y={cy - 12} textAnchor="middle" fontSize={13} fontWeight={800} fill="var(--color-amber-ink)">
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
            fill="var(--color-ink)"
            fillOpacity={0.06}
            stroke="var(--color-ink-muted)"
            strokeOpacity={0.4}
            strokeDasharray="4 3"
          />
          <XAxis
            dataKey="rep"
            tick={{ fill: 'var(--color-ink-muted)', fontSize: 12 }}
            axisLine={{ stroke: 'var(--color-border-strong)' }}
            tickLine={false}
            interval={Math.max(0, Math.ceil(data.length / 12) - 1)}
            label={{ value: 'Rep', position: 'insideBottom', offset: -2, fill: 'var(--color-ink-muted)', fontSize: 12 }}
          />
          <YAxis
            tick={{ fill: 'var(--color-ink-muted)', fontSize: 12 }}
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
              fontSize: 13,
              color: 'var(--color-ink)',
              boxShadow: 'var(--shadow-ambient)',
            }}
            labelStyle={{ color: 'var(--color-ink-muted)' }}
            labelFormatter={(rep) => `Rep ${rep}`}
            formatter={(value, _name, item) => {
              const p = item.payload as RepPoint
              const verdict = p.verdict ?? 'Not scored'
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
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-ink-muted">
        <LegendItem swatch={<span className="h-3 w-5 rounded-sm border border-dashed border-ink-muted bg-ink/5" />} label={`Target ${targetMin}–${targetMax}°`} />
        <LegendItem
          swatch={<span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald text-accent-ink"><Check className="h-2.5 w-2.5" strokeWidth={3.5} aria-hidden /></span>}
          label="Perfect"
        />
        <LegendItem
          swatch={<span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-crimson text-accent-ink"><X className="h-2.5 w-2.5" strokeWidth={3.5} aria-hidden /></span>}
          label="Form fault"
        />
        <LegendItem swatch={<span className="h-3.5 w-3.5 rounded-full border-[1.5px] border-ink-faint" />} label="Not scored" />
        <LegendItem swatch={<span className="w-3.5 text-center text-[13px] font-extrabold text-amber-ink">!</span>} label="Upper arm drifted" />
      </div>
    </div>
  )
}
