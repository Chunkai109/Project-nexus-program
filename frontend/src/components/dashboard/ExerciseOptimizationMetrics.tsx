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

/**
 * Mock aggregate data standing in for a real "roll up every patient's session
 * history for the selected exercise" query. Shapes mirror what that query
 * would return, so wiring this to AppDataContext later is a data-source swap,
 * not a redesign.
 */
const FORM_FAILURE_RATE = 18.4
const failureBreakdown = [
  { name: 'Successful Reps', value: 100 - FORM_FAILURE_RATE },
  { name: 'Fault Reps', value: FORM_FAILURE_RATE },
]
const FAILURE_COLORS = ['var(--color-emerald)', 'var(--color-crimson)']

const emgLimbData = [
  { name: 'Left', value: 71 },
  { name: 'Right', value: 65 },
]

const eccentricTempoData = [
  { session: 'S1', tempo: 1.6 },
  { session: 'S2', tempo: 1.5 },
  { session: 'S3', tempo: 1.5 },
  { session: 'S4', tempo: 1.4 },
  { session: 'S5', tempo: 1.4 },
  { session: 'S6', tempo: 1.3 },
  { session: 'S7', tempo: 1.2 },
  { session: 'S8', tempo: 1.3 },
  { session: 'S9', tempo: 1.1 },
  { session: 'S10', tempo: 1.2 },
]

const tremorOnsetData = [
  { rep: 4, deviation: 3 },
  { rep: 5, deviation: 5 },
  { rep: 6, deviation: 8 },
  { rep: 6, deviation: 6 },
  { rep: 7, deviation: 13 },
  { rep: 7, deviation: 10 },
  { rep: 8, deviation: 24 },
  { rep: 8, deviation: 20 },
  { rep: 8, deviation: 27 },
  { rep: 9, deviation: 22 },
  { rep: 9, deviation: 18 },
  { rep: 10, deviation: 21 },
  { rep: 10, deviation: 16 },
  { rep: 11, deviation: 12 },
  { rep: 12, deviation: 7 },
]

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

function TileHeader({
  label,
  metric,
  metricTone,
  description,
}: {
  label: string
  metric: string
  metricTone: 'crimson' | 'amber' | 'ink'
  description: string
}) {
  const toneClass = metricTone === 'crimson' ? 'text-crimson' : metricTone === 'amber' ? 'text-amber' : 'text-ink'
  return (
    <div className="mb-4">
      <p className="text-[13px] font-medium text-ink-muted">{label}</p>
      <p className={`mt-1 text-[26px] font-semibold tracking-tight ${toneClass}`}>{metric}</p>
      <p className="mt-1 text-[12px] leading-snug text-ink-faint">{description}</p>
    </div>
  )
}

function FormFailureTile() {
  return (
    <Card className="flex flex-col p-6 lg:col-span-2">
      <TileHeader
        label="Form Failure Rate"
        metric={`${FORM_FAILURE_RATE}%`}
        metricTone="crimson"
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
            <span className="ml-auto font-medium text-ink">{(100 - FORM_FAILURE_RATE).toFixed(1)}%</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ background: FAILURE_COLORS[1] }} />
            <span className="text-ink-muted">Fault</span>
            <span className="ml-auto font-medium text-ink">{FORM_FAILURE_RATE.toFixed(1)}%</span>
          </div>
        </div>
      </div>
    </Card>
  )
}

function RomAchievementTile() {
  return (
    <Card className="flex flex-col items-center p-6 lg:col-span-2">
      <TileHeader
        label="Target ROM Achievement"
        metric="102° avg"
        metricTone="amber"
        description="Average maximum flexion achieved across all patient sessions, vs. 110° prescribed."
      />
      <RadialGauge value={102} min={60} max={140} targetMin={106} targetMax={114} unit="°" label="Avg. max flexion" size={168} />
    </Card>
  )
}

function EmgEngagementTile() {
  return (
    <Card className="flex flex-col p-6 lg:col-span-2">
      <TileHeader
        label="Neuromuscular Engagement (EMG)"
        metric="68% MVC"
        metricTone="ink"
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

function EccentricTempoTile() {
  return (
    <Card className="flex flex-col p-6 lg:col-span-3">
      <TileHeader
        label="Eccentric Tempo Control"
        metric="1.2s avg"
        metricTone="crimson"
        description="Average duration of the eccentric (lowering) phase over the last 10 logged sessions (target: >2.0s)."
      />
      <ResponsiveContainer width="100%" height={140}>
        <LineChart data={eccentricTempoData} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
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

function FatigueOnsetTile() {
  return (
    <Card className="flex flex-col p-6 lg:col-span-3">
      <TileHeader
        label="Fatigue Onset / Tremor Detection"
        metric="Rep 8"
        metricTone="amber"
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
          <Scatter data={tremorOnsetData} fill="var(--color-crimson)" fillOpacity={0.65} isAnimationActive={false} />
        </ScatterChart>
      </ResponsiveContainer>
    </Card>
  )
}

export function ExerciseOptimizationMetrics() {
  return (
    <div>
      <div className="mb-5">
        <h2 className="text-[15px] font-semibold text-ink">Exercise Optimization Analytics</h2>
        <p className="text-[13px] text-ink-faint">Aggregate biomechanical performance to refine protocol thresholds.</p>
      </div>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-6">
        <FormFailureTile />
        <RomAchievementTile />
        <EmgEngagementTile />
        <EccentricTempoTile />
        <FatigueOnsetTile />
      </div>
    </div>
  )
}
