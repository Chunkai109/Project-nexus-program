import { useMemo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Card } from '@/components/ui/Card'
import { RadialGauge } from '@/components/charts/RadialGauge'
import type { Exercise } from '@/types'

const FAILURE_COLORS = ['var(--color-emerald)', 'var(--color-crimson)']

const tooltipStyle = {
  contentStyle: {
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: 12,
    fontSize: 12,
    color: 'var(--color-ink)',
    boxShadow: 'var(--shadow-ambient)',
  },
  labelStyle: { color: 'var(--color-ink-muted)' },
}

const axisTick = { fill: 'var(--color-ink-faint)', fontSize: 10 }
const axisLine = { stroke: 'var(--color-border-strong)' }

/** Deterministic string hash → 32-bit seed, so the same exercise always renders the same mock numbers. */
function hashSeed(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Seeded PRNG (mulberry32) — no external dependency needed for a handful of mock values per exercise. */
function mulberry32(seed: number) {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface ExerciseMetrics {
  failureRate: number
  romAvg: number
  romTargetMin: number
  romTargetMax: number
  emgLeft: number
  emgRight: number
  emgAvg: number
  tempoData: { session: string; tempo: number }[]
  tempoAvg: number
  onsetRep: number
  tremorData: { rep: number; deviation: number }[]
}

/**
 * Stands in for a real "roll up this exercise's session history across every
 * patient it's assigned to" query. Seeded off the exercise id (and lightly
 * informed by its own prescribed ROM/EMG targets) so each exercise gets its
 * own consistent-looking numbers instead of one dashboard-wide mock. Swapping
 * this for a real aggregation later is a data-source change, not a redesign.
 */
function buildMockMetrics(exercise: Exercise): ExerciseMetrics {
  const rand = mulberry32(hashSeed(exercise.id))

  const failureRate = Math.round((8 + rand() * 18) * 10) / 10

  const primaryAngle = exercise.angleConfigs[0]
  const romTargetMin = primaryAngle?.targetMin ?? 90
  const romTargetMax = primaryAngle?.targetMax ?? 110
  const romTargetMid = (romTargetMin + romTargetMax) / 2
  const romAvg = Math.round(romTargetMid - (4 + rand() * 14))

  const emgTarget = exercise.targetEmgMvc || 65
  const emgLeft = Math.round(emgTarget * (0.85 + rand() * 0.25))
  const emgRight = Math.round(emgTarget * (0.75 + rand() * 0.25))
  const emgAvg = Math.round((emgLeft + emgRight) / 2)

  const tempoBase = 1.0 + rand() * 0.8
  const tempoData = Array.from({ length: 10 }, (_, i) => ({
    session: `S${i + 1}`,
    tempo: Math.max(0.6, +(tempoBase - i * 0.03 + (rand() - 0.5) * 0.15).toFixed(2)),
  }))
  const tempoAvg = +(tempoData.reduce((sum, p) => sum + p.tempo, 0) / tempoData.length).toFixed(1)

  const onsetRep = Math.round(6 + rand() * 5)
  const tremorData = Array.from({ length: 13 }, () => {
    const rep = Math.max(3, Math.round(onsetRep + (rand() - 0.5) * 7))
    const distanceFromOnset = Math.abs(rep - onsetRep)
    const deviation = Math.max(2, Math.round(28 - distanceFromOnset * 4 + (rand() - 0.5) * 8))
    return { rep, deviation }
  })

  return { failureRate, romAvg, romTargetMin, romTargetMax, emgLeft, emgRight, emgAvg, tempoData, tempoAvg, onsetRep, tremorData }
}

function TileHeader({
  label,
  metric,
  metricTone,
  description,
}: {
  label: string
  metric: string
  metricTone: 'crimson' | 'amber' | 'emerald' | 'ink'
  description: string
}) {
  const toneClass =
    metricTone === 'crimson'
      ? 'text-crimson'
      : metricTone === 'amber'
        ? 'text-amber'
        : metricTone === 'emerald'
          ? 'text-emerald'
          : 'text-ink'
  return (
    <div className="mb-4">
      <p className="text-[13px] font-medium text-ink-muted">{label}</p>
      <p className={`mt-1 text-[26px] font-semibold tracking-tight ${toneClass}`}>{metric}</p>
      <p className="mt-1 text-[12px] leading-snug text-ink-faint">{description}</p>
    </div>
  )
}

function FormFailureTile({ failureRate }: { failureRate: number }) {
  const successRate = 100 - failureRate
  const failureBreakdown = [
    { name: 'Successful Reps', value: successRate },
    { name: 'Fault Reps', value: failureRate },
  ]
  return (
    <Card className="flex flex-col p-6 lg:col-span-2">
      <TileHeader
        label="Form Failure Rate"
        metric={`${failureRate}%`}
        metricTone={failureRate > 20 ? 'crimson' : failureRate > 12 ? 'amber' : 'emerald'}
        description="Percentage of total reps triggering a MediaPipe/IMU form fault (e.g., knee valgus)."
      />
      <div className="flex flex-1 items-center gap-4">
        <ResponsiveContainer width="55%" height={120}>
          <PieChart>
            <Pie
              data={failureBreakdown}
              dataKey="value"
              nameKey="name"
              innerRadius={38}
              outerRadius={54}
              paddingAngle={3}
              isAnimationActive={false}
            >
              {failureBreakdown.map((entry, i) => (
                <Cell key={entry.name} fill={FAILURE_COLORS[i]} stroke="none" />
              ))}
            </Pie>
            <Tooltip {...tooltipStyle} formatter={(v) => `${Number(v).toFixed(1)}%`} />
          </PieChart>
        </ResponsiveContainer>
        <div className="flex flex-1 flex-col gap-2 text-[12px]">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ background: FAILURE_COLORS[0] }} />
            <span className="text-ink-muted">Successful</span>
            <span className="ml-auto font-medium text-ink">{successRate.toFixed(1)}%</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ background: FAILURE_COLORS[1] }} />
            <span className="text-ink-muted">Fault</span>
            <span className="ml-auto font-medium text-ink">{failureRate.toFixed(1)}%</span>
          </div>
        </div>
      </div>
    </Card>
  )
}

function RomAchievementTile({ romAvg, targetMin, targetMax }: { romAvg: number; targetMin: number; targetMax: number }) {
  const inTarget = romAvg >= targetMin && romAvg <= targetMax
  const nearTarget = romAvg >= targetMin - 10 && romAvg <= targetMax + 10
  return (
    <Card className="flex flex-col items-center p-6 lg:col-span-2">
      <TileHeader
        label="Target ROM Achievement"
        metric={`${romAvg}° avg`}
        metricTone={inTarget ? 'emerald' : nearTarget ? 'amber' : 'crimson'}
        description={`Average maximum flexion achieved across all patient sessions, vs. ${targetMax}° prescribed.`}
      />
      <RadialGauge
        value={romAvg}
        min={Math.max(0, targetMin - 40)}
        max={targetMax + 40}
        targetMin={targetMin}
        targetMax={targetMax}
        unit="°"
        label="Avg. max flexion"
        size={168}
      />
    </Card>
  )
}

function EmgEngagementTile({ emgLeft, emgRight, emgAvg }: { emgLeft: number; emgRight: number; emgAvg: number }) {
  const emgLimbData = [
    { name: 'Left', value: emgLeft },
    { name: 'Right', value: emgRight },
  ]
  return (
    <Card className="flex flex-col p-6 lg:col-span-2">
      <TileHeader
        label="Neuromuscular Engagement (EMG)"
        metric={`${emgAvg}% MVC`}
        metricTone={emgAvg >= 75 ? 'emerald' : emgAvg >= 55 ? 'amber' : 'crimson'}
        description="Median peak muscle activation during the concentric phase, by limb."
      />
      <ResponsiveContainer width="100%" height={140}>
        <BarChart data={emgLimbData} margin={{ top: 4, right: 8, bottom: 0, left: -16 }} barSize={44}>
          <CartesianGrid stroke="var(--color-border)" vertical={false} />
          <XAxis dataKey="name" tick={axisTick} axisLine={axisLine} tickLine={false} />
          <YAxis
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            tick={axisTick}
            axisLine={axisLine}
            tickLine={false}
            width={34}
            tickFormatter={(v) => `${v}%`}
          />
          <Tooltip {...tooltipStyle} formatter={(v) => `${v}% MVC`} />
          <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive={false}>
            <Cell fill="var(--color-accent)" />
            <Cell fill="var(--color-emerald)" />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Card>
  )
}

function EccentricTempoTile({ tempoData, tempoAvg }: { tempoData: { session: string; tempo: number }[]; tempoAvg: number }) {
  return (
    <Card className="flex flex-col p-6 lg:col-span-3">
      <TileHeader
        label="Eccentric Tempo Control"
        metric={`${tempoAvg}s avg`}
        metricTone={tempoAvg >= 2.0 ? 'emerald' : tempoAvg >= 1.5 ? 'amber' : 'crimson'}
        description="Average duration of the eccentric (lowering) phase over the last 10 logged sessions (target: >2.0s)."
      />
      <ResponsiveContainer width="100%" height={140}>
        <LineChart data={tempoData} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
          <CartesianGrid stroke="var(--color-border)" vertical={false} />
          <XAxis dataKey="session" tick={axisTick} axisLine={axisLine} tickLine={false} />
          <YAxis
            domain={[0, 2.4]}
            ticks={[0, 1, 2]}
            tick={axisTick}
            axisLine={axisLine}
            tickLine={false}
            width={30}
            tickFormatter={(v) => `${v}s`}
          />
          <Tooltip {...tooltipStyle} formatter={(v) => `${Number(v).toFixed(1)}s`} />
          <ReferenceLine
            y={2.0}
            stroke="var(--color-ink-faint)"
            strokeDasharray="4 4"
            label={{ value: 'Target 2.0s', position: 'insideTopRight', fill: 'var(--color-ink-faint)', fontSize: 10 }}
          />
          <Line
            type="monotone"
            dataKey="tempo"
            stroke="var(--color-crimson)"
            strokeWidth={2.5}
            dot={{ r: 3, fill: 'var(--color-crimson)', strokeWidth: 0 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </Card>
  )
}

function FatigueOnsetTile({ onsetRep, tremorData }: { onsetRep: number; tremorData: { rep: number; deviation: number }[] }) {
  return (
    <Card className="flex flex-col p-6 lg:col-span-3">
      <TileHeader
        label="Fatigue Onset / Tremor Detection"
        metric={`Rep ${onsetRep}`}
        metricTone={onsetRep >= 10 ? 'emerald' : onsetRep >= 7 ? 'amber' : 'crimson'}
        description="Average repetition where high-frequency IMU micro-tremors or EMG drops are detected."
      />
      <ResponsiveContainer width="100%" height={140}>
        <ScatterChart margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
          <CartesianGrid stroke="var(--color-border)" />
          <XAxis
            type="number"
            dataKey="rep"
            domain={[3, 13]}
            ticks={[4, 6, 8, 10, 12]}
            tick={axisTick}
            axisLine={axisLine}
            tickLine={false}
            name="Rep"
            label={{ value: 'Rep number', position: 'insideBottom', offset: -2, fill: 'var(--color-ink-faint)', fontSize: 10 }}
          />
          <YAxis
            type="number"
            dataKey="deviation"
            tick={axisTick}
            axisLine={axisLine}
            tickLine={false}
            width={30}
            name="Deviation"
            tickFormatter={(v) => `${v}%`}
          />
          <Tooltip {...tooltipStyle} formatter={(v, name) => (name === 'Rep' ? v : `${v}% deviation`)} />
          <Scatter data={tremorData} fill="var(--color-crimson)" fillOpacity={0.65} isAnimationActive={false} />
        </ScatterChart>
      </ResponsiveContainer>
    </Card>
  )
}

export function ExerciseOptimizationMetrics({ exercise }: { exercise: Exercise }) {
  const metrics = useMemo(() => buildMockMetrics(exercise), [exercise])

  return (
    <div>
      <div className="mb-5">
        <h2 className="text-[15px] font-semibold text-ink">Exercise Optimization Analytics</h2>
        <p className="text-[13px] text-ink-faint">Aggregate average biomechanical performance among patients to refine protocol thresholds.</p>
      </div>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-6">
        <FormFailureTile failureRate={metrics.failureRate} />
        <RomAchievementTile romAvg={metrics.romAvg} targetMin={metrics.romTargetMin} targetMax={metrics.romTargetMax} />
        <EmgEngagementTile emgLeft={metrics.emgLeft} emgRight={metrics.emgRight} emgAvg={metrics.emgAvg} />
        <EccentricTempoTile tempoData={metrics.tempoData} tempoAvg={metrics.tempoAvg} />
        <FatigueOnsetTile onsetRep={metrics.onsetRep} tremorData={metrics.tremorData} />
      </div>
    </div>
  )
}
