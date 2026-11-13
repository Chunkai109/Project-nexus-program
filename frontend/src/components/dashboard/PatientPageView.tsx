import { useMemo, useState, type ReactNode } from 'react'
import { ArrowLeft, FlaskConical } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { TrendChart } from '@/components/charts/TrendChart'
import { ProgressChart } from '@/components/charts/ProgressChart'
import { VerdictBreakdownChart } from '@/components/charts/VerdictBreakdownChart'
import { formatRelativeTime } from '@/lib/formatRelativeTime'
import { sessionStats, type SessionStats } from '@/lib/sessionStats'
import { PLACEHOLDER_RULES, RULES_ARE_PLACEHOLDERS } from '@/lib/dashboardRules'
import type { Exercise, PatientRecord, SessionRecord } from '@/types'
import { ExerciseListPanel, type ExerciseListSection } from './ExerciseListPanel'
import { Initial } from './RosterView'
import { plural, progressTakeaway, repAnglesTakeaway, verdictTakeaway, type RosterStatus } from './physioModel'
import { ChangeText, StatTile } from './ui/StatTile'
import { StatusPill } from './ui/StatusPill'
import { SectionCard } from './ui/SectionCard'
import { SegmentedTabs } from './ui/SegmentedTabs'

const PROGRESS_SESSIONS = 10
const DAY_MS = 24 * 60 * 60 * 1000

type PatientTab = 'progress' | 'plan'

export interface PatientPageData {
  patient: PatientRecord
  status: RosterStatus
  reason: string | null
  /** The patient's sessions, oldest first: real ones, or labelled demo history when they have none (isDemo). */
  history: SessionRecord[]
  isDemo: boolean
  /** Their exercise plans, newest first. */
  plans: Exercise[]
  /** When the latest real session finished. Null when there is none. */
  lastRealSessionAt: number | null
}

function Tiles({ stats, now }: { stats: SessionStats[]; now: number }) {
  const latest = stats[stats.length - 1]
  const previous = stats.length > 1 ? stats[stats.length - 2] : null
  const goodFormLabel = PLACEHOLDER_RULES.goodFormVerdicts.join(' or ')
  const first = <span className="text-ink-muted">First session of this exercise</span>
  const noComparison = <span className="text-ink-muted">No comparison: the AI did not score one of the two sessions</span>
  const lastWeek = stats.filter((s) => now - s.session.completedAt < 7 * DAY_MS).length
  return (
    <div className="grid grid-cols-1 gap-4 @md:grid-cols-2 @3xl:grid-cols-4">
      <StatTile
        label="Good form"
        value={latest.goodFormPct === null ? '—' : `${latest.goodFormPct}%`}
        change={!previous ? first : latest.goodFormPct === null || previous.goodFormPct === null ? noComparison : <ChangeText delta={latest.goodFormPct - previous.goodFormPct} unit="pts" />}
        footnote={latest.aiScored === 0 ? `The AI scored none of ${plural(latest.totalReps, 'rep')}` : `${latest.goodForm} ${goodFormLabel} of ${latest.aiScored} scored reps, ${latest.unscored} not scored`}
      />
      <StatTile
        label="In range"
        value={latest.inRangePct === null ? '—' : `${latest.inRangePct}%`}
        change={!previous ? first : latest.inRangePct === null || previous.inRangePct === null ? noComparison : <ChangeText delta={latest.inRangePct - previous.inRangePct} unit="pts" />}
        footnote={`${latest.inRange} of ${plural(latest.totalReps, 'rep')}, target ${latest.session.targetMin}–${latest.session.targetMax}°`}
      />
      <StatTile
        label="Drift faults"
        value={String(latest.driftFaults)}
        change={!previous ? first : <ChangeText delta={latest.driftFaults - previous.driftFaults} unit="count" better="lower" />}
        footnote="Reps where the upper arm moved too far"
      />
      <StatTile
        label="Sessions done"
        value={String(stats.length)}
        change={<span className="text-ink-muted">{lastWeek} in the last 7 days</span>}
        footnote={`${latest.session.exerciseTitle}, last done ${formatRelativeTime(latest.session.completedAt)}`}
      />
    </div>
  )
}

function ProgressPanel({ data, now }: { data: PatientPageData; now: number }) {
  const { history, plans, isDemo, patient } = data
  const [exerciseChoice, setExerciseChoice] = useState<string | null>(null)

  const sections = useMemo<ExerciseListSection[]>(() => {
    const byExercise = new Map<string, { count: number; last: number; title: string }>()
    for (const s of history) {
      const prev = byExercise.get(s.exerciseId)
      byExercise.set(s.exerciseId, { count: (prev?.count ?? 0) + 1, last: Math.max(prev?.last ?? 0, s.completedAt), title: !prev || s.completedAt >= prev.last ? s.exerciseTitle : prev.title })
    }
    const detail = (id: string) => {
      const h = byExercise.get(id)
      return h ? `${plural(h.count, 'session')}, last ${formatRelativeTime(h.last)}` : 'No sessions yet'
    }
    const planIds = new Set(plans.map((p) => p.id))
    const earlier = [...byExercise.entries()]
      .filter(([id]) => !planIds.has(id))
      .sort((a, b) => b[1].last - a[1].last)
      .map(([id, h]) => ({ id, title: isDemo ? 'Demo session' : h.title, detail: isDemo ? `Demo data, ${detail(id)}` : detail(id) }))
    return [
      { items: plans.map((p) => ({ id: p.id, title: p.title, detail: detail(p.id) })) },
      { label: plans.length > 0 ? 'Earlier exercises' : undefined, items: earlier },
    ]
  }, [history, plans, isDemo])

  const items = sections.flatMap((s) => s.items)
  const latestExerciseId = history[history.length - 1]?.exerciseId
  const exerciseId = items.find((i) => i.id === exerciseChoice)?.id ?? items.find((i) => i.id === latestExerciseId)?.id ?? items[0]?.id ?? null
  const selectedTitle = items.find((i) => i.id === exerciseId)?.title
  const stats = useMemo(() => history.filter((s) => s.exerciseId === exerciseId).map((s) => sessionStats(s)), [history, exerciseId])
  const latest = stats[stats.length - 1]
  const shown = stats.slice(-PROGRESS_SESSIONS)

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      <ExerciseListPanel
        title={`Exercises (${items.length})`}
        ariaLabel={`${patient.name}'s exercises`}
        emptyText="No exercises or sessions yet."
        selectedId={exerciseId}
        onSelect={setExerciseChoice}
        sections={sections}
      />
      <div className="@container flex min-w-0 flex-col gap-6 lg:col-span-8 xl:col-span-9">
        {isDemo && (
          <p className="flex items-start gap-2.5 rounded-xl bg-amber/10 px-4 py-3 text-[14px] font-medium text-amber-ink">
            <FlaskConical className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
            No real sessions yet. These charts show demo data, not a recorded session.
          </p>
        )}
        {!latest ? (
          <Card className="p-12 text-center">
            <p className="text-[15px] text-ink-muted">
              {selectedTitle ? `No sessions with ${selectedTitle} yet.` : 'No sessions yet.'} Progress appears after the patient finishes one.
            </p>
          </Card>
        ) : (
          <>
            <Tiles stats={stats} now={now} />
            <SectionCard title="Progress across sessions" subtitle={progressTakeaway(shown)}>
              <ProgressChart stats={shown} />
            </SectionCard>
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              <SectionCard title="Rep angles, latest session" subtitle={repAnglesTakeaway(latest)}>
                <TrendChart reps={latest.session.reps} targetMin={latest.session.targetMin} targetMax={latest.session.targetMax} />
              </SectionCard>
              <SectionCard title="AI verdicts, latest session" subtitle={verdictTakeaway(latest.session)}>
                <VerdictBreakdownChart session={latest.session} />
              </SectionCard>
            </div>
            {RULES_ARE_PLACEHOLDERS && (
              <p className="text-[13px] text-ink-muted">
                <span className="font-semibold text-amber-ink">Placeholder rule:</span> good form is reps the AI scored {PLACEHOLDER_RULES.goodFormVerdicts.join(' or ')}, out of
                the reps it scored, until a physiotherapist confirms the rule.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/**
 * One patient's page: header card, then Progress and Exercise plan tabs.
 * Pure view: the container passes the data and the plan panel, so the same
 * page renders real data or demo data.
 */
export function PatientPageView({
  data,
  planPanel,
  onBack,
  guard = (action) => action(),
  now: nowProp,
}: {
  data: PatientPageData
  planPanel: ReactNode
  onBack: () => void
  /** Runs an action that leaves the plan editor, asking first if it has unsaved changes. */
  guard?: (action: () => void) => void
  now?: number
}) {
  const [tab, setTab] = useState<PatientTab>('progress')
  const [mountedAt] = useState(() => Date.now())
  const now = nowProp ?? mountedAt
  const { patient, status, reason, plans, lastRealSessionAt } = data
  return (
    <div className="flex flex-col gap-6">
      <div>
        <button
          type="button"
          onClick={() => guard(onBack)}
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg text-[14px] font-semibold text-accent hover:underline"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to patients
        </button>
        <Card className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-3 p-5">
          <div className="flex min-w-0 items-center gap-4">
            <Initial name={patient.name} size="lg" />
            <div className="min-w-0">
              <h1 className="truncate text-[28px] font-semibold leading-tight tracking-tight text-ink" title={patient.name}>
                {patient.name}
              </h1>
              <p className="truncate text-[14px] text-ink-muted" title={patient.email}>
                {patient.email}
              </p>
            </div>
          </div>
          <div className="min-w-[180px]">
            <StatusPill status={status} reason={reason} size="lg" />
          </div>
          <dl className="ml-auto flex flex-wrap gap-x-6 gap-y-1 text-[14px]">
            <div>
              <dt className="text-[13px] text-ink-muted">Last session</dt>
              <dd className="font-medium text-ink">{lastRealSessionAt ? formatRelativeTime(lastRealSessionAt) : 'No sessions yet'}</dd>
            </div>
            <div>
              <dt className="text-[13px] text-ink-muted">Exercise plan</dt>
              <dd className="font-medium text-ink">{plans.length === 0 ? 'No exercises in plan yet' : `${plural(plans.length, 'exercise')} in plan`}</dd>
            </div>
          </dl>
        </Card>
      </div>

      <div className="self-start">
      <SegmentedTabs
        idPrefix="patient"
        label="Patient views"
        value={tab}
        onChange={(next) => {
          if (next !== tab) guard(() => setTab(next))
        }}
        tabs={[
          { key: 'progress', label: 'Progress' },
          { key: 'plan', label: 'Exercise plan' },
        ]}
      />
      </div>

      {tab === 'progress' ? (
        <div role="tabpanel" id="patient-tabpanel-progress" aria-labelledby="patient-tab-progress">
          <ProgressPanel data={data} now={now} />
        </div>
      ) : (
        <div role="tabpanel" id="patient-tabpanel-plan" aria-labelledby="patient-tab-plan">
          {planPanel}
        </div>
      )}
    </div>
  )
}
