import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { clsx } from 'clsx'
import { ChevronDown } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { TrendChart } from '@/components/charts/TrendChart'
import { ProgressChart } from '@/components/charts/ProgressChart'
import { VerdictBreakdownChart } from '@/components/charts/VerdictBreakdownChart'
import { HeadlineCards } from '@/components/dashboard/HeadlineCards'
import { HoverExplain } from '@/components/ui/HoverExplain'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { PatientExercisePlan } from '@/components/dashboard/PatientExercisePlan'
import { ExerciseListPanel } from '@/components/dashboard/ExerciseListPanel'
import { useAppData } from '@/lib/data/AppDataContext'
import { formatRelativeTime } from '@/lib/formatRelativeTime'
import { historyFor, sessionStats } from '@/lib/sessionStats'

const PROGRESS_SESSIONS = 10

type PatientTab = 'progress' | 'plan'
const TABS: { key: PatientTab; label: string }[] = [
  { key: 'progress', label: 'Progress' },
  { key: 'plan', label: 'Exercise plan' },
]

/**
 * One patient's page: the Progress tab (session analytics, filtered to one
 * exercise) and the Exercise plan tab (their own tailored exercises).
 */
export function TelemetrySection({
  initialPatientId,
  onDirtyChange,
  onOpenCreator,
}: {
  initialPatientId?: string
  /** Tells the dashboard the plan editor has unsaved changes, so leaving the page can ask first. */
  onDirtyChange?: (dirty: boolean) => void
  onOpenCreator: () => void
}) {
  const { patients, sessions, exercises } = useAppData()
  const [patientId, setPatientId] = useState<string | undefined>(initialPatientId)
  const patient = patients.find((p) => p.id === patientId) ?? patients[0]
  const [tab, setTab] = useState<PatientTab>('progress')
  const [exerciseChoice, setExerciseChoice] = useState<string | null>(null)

  // Unsaved-changes guard for switching tab or patient while the plan editor is open.
  const dirtyRef = useRef(false)
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)
  const handleDirtyChange = useCallback(
    (dirty: boolean) => {
      dirtyRef.current = dirty
      onDirtyChange?.(dirty)
    },
    [onDirtyChange],
  )
  function guard(action: () => void) {
    if (dirtyRef.current) setPendingAction(() => action)
    else action()
  }

  // Real sessions, or clearly-labelled placeholder history if there are none yet.
  const { sessions: allHistory, isDemo } = useMemo(
    () => (patient ? historyFor(patient.id, sessions) : { sessions: [], isDemo: false }),
    [patient, sessions],
  )

  // The left-hand list: this patient's plan (same order as the Exercise plan
  // tab), then "Earlier exercises" for sessions whose exercise isn't in the
  // plan any more (a removed plan, an old preset, or demo data).
  const listSections = useMemo(() => {
    const byExercise = new Map<string, { count: number; last: number; title: string }>()
    for (const s of allHistory) {
      const prev = byExercise.get(s.exerciseId)
      byExercise.set(s.exerciseId, {
        count: (prev?.count ?? 0) + 1,
        last: Math.max(prev?.last ?? 0, s.completedAt),
        title: !prev || s.completedAt >= prev.last ? s.exerciseTitle : prev.title,
      })
    }
    const detail = (id: string) => {
      const h = byExercise.get(id)
      if (!h) return 'No sessions yet'
      return `${h.count} session${h.count === 1 ? '' : 's'} · last ${formatRelativeTime(h.last)}`
    }
    const plans = patient ? exercises.filter((e) => e.assignedPatientId === patient.id).sort((a, b) => b.createdAt - a.createdAt) : []
    const planIds = new Set(plans.map((p) => p.id))
    const earlier = [...byExercise.entries()]
      .filter(([id]) => !planIds.has(id))
      .sort((a, b) => b[1].last - a[1].last)
      .map(([id, h]) => ({
        id,
        title: isDemo ? 'Demo session' : h.title,
        detail: isDemo ? `Demo data · ${detail(id)}` : detail(id),
      }))
    return [
      {
        items: plans.map((p) => ({
          id: p.id,
          title: p.title,
          detail: detail(p.id),
        })),
      },
      {
        label: plans.length > 0 ? 'Earlier exercises' : undefined,
        items: earlier,
      },
    ]
  }, [allHistory, exercises, patient, isDemo])
  const listItems = listSections.flatMap((sec) => sec.items)
  // Default: the exercise of the most recent session, else the newest plan.
  const latestExerciseId = allHistory[allHistory.length - 1]?.exerciseId
  const exerciseId =
    listItems.find((i) => i.id === exerciseChoice)?.id ?? listItems.find((i) => i.id === latestExerciseId)?.id ?? listItems[0]?.id ?? null
  const selectedTitle = listItems.find((i) => i.id === exerciseId)?.title
  const history = useMemo(() => allHistory.filter((s) => s.exerciseId === exerciseId), [allHistory, exerciseId])
  const stats = useMemo(() => history.map((s) => sessionStats(s)), [history])
  const latest = stats[stats.length - 1]
  const previous = stats.length > 1 ? stats[stats.length - 2] : null
  const shownSessions = Math.min(PROGRESS_SESSIONS, stats.length)

  if (patients.length === 0) {
    return (
      <Card className="p-7">
        <p className="rounded-xl bg-surface-secondary p-6 text-center text-[13px] text-ink-faint">
          No patients have signed in yet — progress will show here once someone completes a session.
        </p>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-ink">{patient?.name}</p>
          <p className="text-[13px] text-ink-muted">
            {allHistory.length > 0
              ? `Latest session: ${allHistory[allHistory.length - 1].exerciseTitle} · ${formatRelativeTime(allHistory[allHistory.length - 1].completedAt)}`
              : 'No sessions yet'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {isDemo && (
            <HoverExplain
              explanation={`${patient?.name} hasn't finished a live session yet, so everything on this page is placeholder data derived from their id — including the AI verdicts — not a recorded session. Real data replaces it the moment they press "End Session & Sync Data".`}
            >
              <Badge tone="amber">Demo data — not a real session</Badge>
            </HoverExplain>
          )}
          <HoverExplain explanation="Switch to a different patient.">
            <div className="relative flex items-center gap-2 rounded-full bg-surface-secondary px-4 py-2">
              <span className="text-[13px] text-ink-faint">Patient:</span>
              <select
                value={patient?.id}
                onChange={(e) => {
                  const next = e.target.value
                  guard(() => {
                    setPatientId(next)
                    setExerciseChoice(null)
                  })
                }}
                className="appearance-none bg-transparent pr-5 text-[13px] font-medium text-ink outline-none"
              >
                {patients.map((p) => (
                  <option key={p.id} value={p.id} className="bg-surface text-ink">
                    {p.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3.5 h-3.5 w-3.5 text-ink-faint" />
            </div>
          </HoverExplain>
        </div>
      </Card>

      <PatientTabs
        tab={tab}
        onChange={(next) => {
          if (next !== tab) guard(() => setTab(next))
        }}
      />

      {tab === 'plan' && patient && (
        <div role="tabpanel" id="patient-tabpanel-plan" aria-labelledby="patient-tab-plan">
          <PatientExercisePlan key={patient.id} patient={patient} onDirtyChange={handleDirtyChange} onOpenCreator={onOpenCreator} />
        </div>
      )}

      <ConfirmDialog
        open={pendingAction !== null}
        message="Discard unsaved changes?"
        cancelLabel="Keep editing"
        confirmLabel="Discard"
        danger
        onCancel={() => setPendingAction(null)}
        onConfirm={() => {
          const action = pendingAction
          setPendingAction(null)
          dirtyRef.current = false
          action?.()
        }}
      />

      {tab === 'progress' && (
        <div
          role="tabpanel"
          id="patient-tabpanel-progress"
          aria-labelledby="patient-tab-progress"
          className="grid grid-cols-1 gap-6 lg:grid-cols-12"
        >
          <ExerciseListPanel
            title={`Exercises (${listItems.length})`}
            ariaLabel={`${patient?.name ?? 'Patient'}'s exercises`}
            emptyText="No exercises or sessions yet."
            selectedId={exerciseId}
            onSelect={setExerciseChoice}
            sections={listSections}
          />
          <div className="@container flex min-w-0 flex-col gap-6 lg:col-span-8 xl:col-span-9">
            {!latest ? (
              <Card className="p-14 text-center">
                <p className="text-[14px] text-ink-muted">
                  {selectedTitle ? `No sessions with ${selectedTitle} yet.` : 'No sessions yet.'} Progress shows here after the patient
                  finishes one.
                </p>
              </Card>
            ) : (
              <>
                <HeadlineCards latest={latest} previous={previous} sessionCount={stats.length} />

                <Card className="p-7">
                  <HoverExplain explanation="Good-form % and in-target-range % for each session, oldest to newest. Rising lines mean the patient is improving.">
                    <div>
                      <p className="text-[15px] font-semibold text-ink">Progress across sessions</p>
                      <p className="mb-4 text-[13px] text-ink-faint">
                        {shownSessions === 1 ? 'Only 1 session so far' : `Last ${shownSessions} sessions`}, one dot per session
                      </p>
                      <ProgressChart stats={stats.slice(-PROGRESS_SESSIONS)} />
                    </div>
                  </HoverExplain>
                </Card>

                <div className="grid grid-cols-1 gap-6 @4xl:grid-cols-2">
                  <Card className="p-7">
                    <HoverExplain explanation="Peak elbow angle of every rep in the latest session against the prescribed target range, marked with the AI's verdict and any drift fault.">
                      <div>
                        <p className="text-[15px] font-semibold text-ink">Rep angles, latest session</p>
                        <p className="mb-4 text-[13px] text-ink-faint">Peak angle per rep vs the target range</p>
                        <TrendChart reps={latest.session.reps} targetMin={latest.session.targetMin} targetMax={latest.session.targetMax} />
                      </div>
                    </HoverExplain>
                  </Card>
                  <Card className="p-7">
                    <HoverExplain explanation="How the AI form check rated each rep in the latest session. The most common fault is usually the thing to coach.">
                      <div>
                        <p className="text-[15px] font-semibold text-ink">AI verdicts, latest session</p>
                        <p className="mb-4 text-[13px] text-ink-faint">What the AI saw, most common first</p>
                        <VerdictBreakdownChart session={latest.session} />
                      </div>
                    </HoverExplain>
                  </Card>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** "Progress" / "Exercise plan" tabs. Arrow keys, Home and End move between them. */
function PatientTabs({ tab, onChange }: { tab: PatientTab; onChange: (tab: PatientTab) => void }) {
  const refs = useRef<Record<PatientTab, HTMLButtonElement | null>>({
    progress: null,
    plan: null,
  })
  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    const i = TABS.findIndex((t) => t.key === tab)
    const next =
      e.key === 'ArrowRight'
        ? TABS[(i + 1) % TABS.length]
        : e.key === 'ArrowLeft'
          ? TABS[(i - 1 + TABS.length) % TABS.length]
          : e.key === 'Home'
            ? TABS[0]
            : e.key === 'End'
              ? TABS[TABS.length - 1]
              : null
    if (!next) return
    e.preventDefault()
    refs.current[next.key]?.focus()
    onChange(next.key)
  }
  return (
    <div role="tablist" aria-label="Patient views" className="-mt-2 flex gap-1">
      {TABS.map((t) => {
        const selected = t.key === tab
        return (
          <button
            key={t.key}
            ref={(el) => {
              refs.current[t.key] = el
            }}
            type="button"
            role="tab"
            id={`patient-tab-${t.key}`}
            aria-selected={selected}
            aria-controls={`patient-tabpanel-${t.key}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.key)}
            onKeyDown={onKeyDown}
            className={clsx(
              'rounded-xl px-3 py-2.5 text-sm font-medium transition-colors duration-200',
              selected ? 'bg-accent/10 text-accent' : 'text-ink-muted hover:bg-surface-secondary hover:text-ink',
            )}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}
