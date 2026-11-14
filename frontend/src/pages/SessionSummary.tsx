import { useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { Button } from '@/components/ui/Button'
import { SessionSummaryView } from '@/components/patient/SessionSummaryView'
import { useAppData } from '@/lib/data/AppDataContext'
import { sessionStats } from '@/lib/sessionStats'

export function SessionSummary() {
  const { sessionId } = useParams()
  const navigate = useNavigate()
  const { sessions } = useAppData()
  const session = useMemo(() => sessions.find((s) => s.id === sessionId) ?? null, [sessions, sessionId])
  const priorSession = useMemo(() => {
    if (!session) return null
    return (
      sessions
        .filter(
          (s) => s.id !== session.id && s.patientId === session.patientId && s.exerciseId === session.exerciseId && s.completedAt < session.completedAt,
        )
        .sort((a, b) => b.completedAt - a.completedAt)[0] ?? null
    )
  }, [sessions, session])

  if (!session) {
    return (
      <PageShell fullWidth>
        <main className="flex min-h-app flex-col items-center justify-center gap-4 px-6 text-center">
          <p className="text-[17px] font-semibold text-ink">Session not found</p>
          <p className="max-w-sm text-[14px] text-ink-faint">
            This session record may no longer be available. Head back to your exercise list to start a new one.
          </p>
          <Button onClick={() => navigate('/patient/exercises')}>
            <ArrowLeft className="h-4 w-4" />
            Back to Exercises
          </Button>
        </main>
      </PageShell>
    )
  }

  const stats = sessionStats(session)
  const previous = priorSession ? sessionStats(priorSession) : null
  // emgLeft is the single bicep channel on this rig; shown only under Details. Where it came from
  // (sensor or simulated) isn't stored with the session, only handed over by Live when it ends.
  const avgEffortPct =
    session.reps.length === 0 ? null : Math.round(session.reps.reduce((sum, r) => sum + r.emgLeft, 0) / session.reps.length)

  return (
    <PageShell fullWidth>
      <SessionSummaryView stats={stats} previous={previous} avgEffortPct={avgEffortPct} onDone={() => navigate('/patient/exercises')} />
    </PageShell>
  )
}
