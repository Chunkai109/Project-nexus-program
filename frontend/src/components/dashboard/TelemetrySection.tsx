import { useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { TrendChart } from '@/components/charts/TrendChart'
import { ProgressChart } from '@/components/charts/ProgressChart'
import { VerdictBreakdownChart } from '@/components/charts/VerdictBreakdownChart'
import { HeadlineCards } from '@/components/dashboard/HeadlineCards'
import { HoverExplain } from '@/components/ui/HoverExplain'
import { useAppData } from '@/lib/data/AppDataContext'
import { formatRelativeTime } from '@/lib/formatRelativeTime'
import { historyFor, sessionStats } from '@/lib/sessionStats'

const PROGRESS_SESSIONS = 10

export function TelemetrySection({ initialPatientId }: { initialPatientId?: string }) {
  const { patients, sessions } = useAppData()
  const [patientId, setPatientId] = useState<string | undefined>(initialPatientId)
  const patient = patients.find((p) => p.id === patientId) ?? patients[0]

  // Real sessions, or clearly-labelled placeholder history if there are none yet.
  const { sessions: history, isDemo } = useMemo(
    () => (patient ? historyFor(patient.id, sessions) : { sessions: [], isDemo: false }),
    [patient, sessions],
  )
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
          <p className="text-[13px] text-ink-faint">
            {latest
              ? `Latest session: ${latest.session.exerciseTitle} · ${formatRelativeTime(latest.session.completedAt)} · ${latest.totalReps} reps`
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
                onChange={(e) => setPatientId(e.target.value)}
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

      {latest && (
        <>
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
        </>
      )}
    </div>
  )
}
