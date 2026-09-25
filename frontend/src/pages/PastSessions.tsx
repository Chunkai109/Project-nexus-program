import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarClock, ChevronRight, Repeat, Timer } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { PatientTopNav } from '@/components/layout/PatientTopNav'
import { PatientNavTabs } from '@/components/layout/PatientNavTabs'
import { Card } from '@/components/ui/Card'
import { useAppData } from '@/lib/data/AppDataContext'
import { useAuth } from '@/lib/AuthContext'
import { formatRelativeTime } from '@/lib/formatRelativeTime'

export function PastSessions() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { sessions, patients } = useAppData()
  const myPatientId = patients.find((p) => p.email === user?.email)?.id
  const mySessions = useMemo(
    () => sessions.filter((s) => s.patientId === myPatientId).sort((a, b) => b.completedAt - a.completedAt),
    [sessions, myPatientId],
  )

  return (
    <PageShell>
      <PatientTopNav weeklyDone={3} weeklyTotal={4} battery={92} bleConnected />

      <main className="px-10 py-12">
        <PatientNavTabs />

        <div className="mb-10">
          <h1 className="text-[28px] font-semibold tracking-tight text-ink">Past Sessions</h1>
          <p className="mt-1.5 text-[15px] text-ink-muted">
            {mySessions.length === 0
              ? "You haven't completed a session yet."
              : `${mySessions.length} completed session${mySessions.length === 1 ? '' : 's'}.`}
          </p>
        </div>

        {mySessions.length === 0 ? (
          <Card className="flex flex-col items-center gap-3 p-16 text-center">
            <CalendarClock className="h-8 w-8 text-ink-faint" />
            <p className="text-[15px] font-medium text-ink">No sessions completed yet</p>
            <p className="max-w-sm text-[13px] text-ink-faint">
              Finish a live session and it'll show up here with your rep-by-rep results.
            </p>
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            {mySessions.map((s) => (
              <button
                key={s.id}
                onClick={() => navigate(`/patient/session-summary/${s.id}`)}
                className="w-full text-left"
              >
                <Card className="flex items-center justify-between gap-4 p-5 transition-transform duration-200 hover:-translate-y-0.5">
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-semibold text-ink">{s.exerciseTitle}</p>
                    <p className="mt-0.5 text-[13px] text-ink-faint">{formatRelativeTime(s.completedAt)}</p>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-5 text-[13px] text-ink-muted">
                    <span className="flex items-center gap-1.5">
                      <Repeat className="h-3.5 w-3.5 text-accent" />
                      {s.reps.length} rep{s.reps.length === 1 ? '' : 's'}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Timer className="h-3.5 w-3.5 text-accent" />
                      {String(Math.floor(s.durationSec / 60)).padStart(2, '0')}:{String(s.durationSec % 60).padStart(2, '0')}
                    </span>
                    <ChevronRight className="h-4 w-4 text-ink-faint" />
                  </div>
                </Card>
              </button>
            ))}
          </div>
        )}
      </main>
    </PageShell>
  )
}
