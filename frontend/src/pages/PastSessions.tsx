import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarClock, ChevronRight } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { PatientTopNav } from '@/components/layout/PatientTopNav'
import { PatientNavTabs } from '@/components/layout/PatientNavTabs'
import { Card } from '@/components/ui/Card'
import { formatClock } from '@/components/patient/format'
import { useAppData } from '@/lib/data/AppDataContext'
import { useAuth } from '@/lib/AuthContext'
import { formatRelativeTime } from '@/lib/formatRelativeTime'
import { sessionStats } from '@/lib/sessionStats'

export function PastSessions() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { sessions, patients } = useAppData()
  const myPatientId = patients.find((p) => p.email === user?.email)?.id
  const rows = useMemo(
    () =>
      sessions
        .filter((s) => s.patientId === myPatientId)
        .sort((a, b) => b.completedAt - a.completedAt)
        .map((s) => sessionStats(s)),
    [sessions, myPatientId],
  )

  return (
    <PageShell>
      <PatientTopNav />

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-10">
        <PatientNavTabs />

        <div className="mb-8">
          <h1 className="text-[30px] font-bold tracking-tight text-ink">Past sessions</h1>
          <p className="mt-1.5 text-[17px] text-ink-muted">
            {rows.length === 0 ? "You haven't completed a session yet." : `${rows.length} completed session${rows.length === 1 ? '' : 's'}.`}
          </p>
        </div>

        {rows.length === 0 ? (
          <Card className="flex flex-col items-center gap-3 p-14 text-center">
            <CalendarClock className="h-9 w-9 text-ink-faint" aria-hidden />
            <p className="text-[18px] font-semibold text-ink">No sessions completed yet</p>
            <p className="max-w-sm text-[16px] text-ink-muted">Finish an exercise and it will show up here with your results.</p>
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            {rows.map((st) => {
              const s = st.session
              return (
                <button key={s.id} type="button" onClick={() => navigate(`/patient/session-summary/${s.id}`)} className="w-full rounded-2xl text-left">
                  <Card className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 p-5 transition-colors duration-200 hover:bg-surface-secondary">
                    <div className="min-w-0">
                      <p className="truncate text-[18px] font-bold text-ink">{s.exerciseTitle}</p>
                      <p className="mt-0.5 text-[15px] text-ink-muted">
                        {new Date(s.completedAt).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} ·{' '}
                        {formatRelativeTime(s.completedAt)} · {st.totalReps} reps · {formatClock(s.durationSec)}
                      </p>
                    </div>
                    <dl className="flex flex-shrink-0 items-center gap-6 text-[15px]">
                      <div>
                        <dt className="text-[13px] text-ink-muted">Good form</dt>
                        <dd className="font-bold text-ink">{st.goodFormPct === null ? '—' : `${st.goodFormPct}%`}</dd>
                      </div>
                      <div>
                        <dt className="text-[13px] text-ink-muted">In range</dt>
                        <dd className="font-bold text-ink">{st.inRangePct === null ? '—' : `${st.inRangePct}%`}</dd>
                      </div>
                      <div>
                        <dt className="text-[13px] text-ink-muted">Drift faults</dt>
                        <dd className="font-bold text-ink">{st.driftFaults}</dd>
                      </div>
                      <ChevronRight className="h-5 w-5 text-ink-faint" aria-hidden />
                    </dl>
                  </Card>
                </button>
              )
            })}
          </div>
        )}
      </main>
    </PageShell>
  )
}
