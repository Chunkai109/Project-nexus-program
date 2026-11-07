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
  const { patients, sessions } = useAppData()
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

  // Exercises this patient has sessions for, most recent first, each labelled by its latest session's title.
  const exerciseOptions = useMemo(() => {
    const latestById = new Map<string, { id: string; title: string; at: number }>()
    for (const s of allHistory) {
      const prev = latestById.get(s.exerciseId)
      if (!prev || s.completedAt >= prev.at) latestById.set(s.exerciseId, { id: s.exerciseId, title: s.exerciseTitle, at: s.completedAt })
    }
    return [...latestById.values()].sort((a, b) => b.at - a.at)
  }, [allHistory])
  const exerciseId = exerciseOptions.find((o) => o.id === exerciseChoice)?.id ?? exerciseOptions[0]?.id ?? null
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
          {tab === 'progress' && exerciseOptions.length > 0 && (
            <ExercisePicker isDemo={isDemo} options={exerciseOptions} value={exerciseId} onChange={setExerciseChoice} />
          )}
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

      {tab === 'progress' && latest && (
        <div role="tabpanel" id="patient-tabpanel-progress" aria-labelledby="patient-tab-progress" className="flex flex-col gap-6">
          <HeadlineCards latest={latest} previous={previous} sessionCount={stats.length} />

          <Card className="p-7">
            <HoverExplain explanation="Good-form % and in-target-range % for each session, oldest to newest. Rising lines mean the patient is improving.">
              <div>
                <p className="text-[15px] font-semibold text-ink">Progress across sessions</p>
                <p className="mb-4 text-[13px] text-ink-faint">{shownSessions === 1 ? 'Only 1 session so far' : `Last ${shownSessions} sessions`}, one dot per session</p>
                <ProgressChart stats={stats.slice(-PROGRESS_SESSIONS)} />
              </div>
            </HoverExplain>
          </Card>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <Card className="p-7">
              <HoverExplain explanation="Peak elbow angle of every rep in the latest session against the prescribed target range, marked with the AI's verdict and any drift fault.">
                <div>
                  <p className="text-[15px] font-semibold text-ink">Rep angles, latest session</p>
                  <p className="mb-4 text-[13px] text-ink-faint">Peak angle per rep vs the target range</p>
                  <TrendChart
                    reps={latest.session.reps}
                    targetMin={latest.session.targetMin}
                    targetMax={latest.session.targetMax}
                  />
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
        </div>
      )}
    </div>
  )
}

function ExercisePicker({
  isDemo,
  options,
  value,
  onChange,
}: {
  isDemo: boolean
  options: { id: string; title: string }[]
  value: string | null
  onChange: (id: string) => void
}) {
  const pill = 'flex items-center gap-2 rounded-full bg-surface-secondary px-4 py-2 text-[13px]'
  if (isDemo || options.length === 1) {
    return (
      <div className={pill}>
        <span className="text-ink-muted">Exercise:</span>
        <span className="font-medium text-ink">{isDemo ? 'Demo session' : options[0].title}</span>
      </div>
    )
  }
  return (
    <HoverExplain explanation="Show progress for one exercise at a time. Sessions done and the vs-last-session changes count this exercise only.">
      <div className={clsx(pill, 'relative')}>
        <label htmlFor="progress-exercise" className="text-ink-muted">
          Exercise:
        </label>
        <select
          id="progress-exercise"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className="max-w-[220px] appearance-none truncate bg-transparent pr-5 font-medium text-ink outline-none"
        >
          {options.map((o) => (
            <option key={o.id} value={o.id} className="bg-surface text-ink">
              {o.title}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3.5 h-3.5 w-3.5 text-ink-faint" />
      </div>
    </HoverExplain>
  )
}

/** "Progress" / "Exercise plan" tabs. Arrow keys, Home and End move between them. */
function PatientTabs({ tab, onChange }: { tab: PatientTab; onChange: (tab: PatientTab) => void }) {
  const refs = useRef<Record<PatientTab, HTMLButtonElement | null>>({ progress: null, plan: null })
  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    const i = TABS.findIndex((t) => t.key === tab)
    const next =
      e.key === 'ArrowRight' ? TABS[(i + 1) % TABS.length]
      : e.key === 'ArrowLeft' ? TABS[(i - 1 + TABS.length) % TABS.length]
      : e.key === 'Home' ? TABS[0]
      : e.key === 'End' ? TABS[TABS.length - 1]
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
