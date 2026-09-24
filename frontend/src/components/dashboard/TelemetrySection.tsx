import { useMemo, useState } from 'react'
import { ChevronDown, LineChart } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { TrendChart } from '@/components/charts/TrendChart'
import { SymmetryBarChart } from '@/components/charts/SymmetryBarChart'
import { useAppData } from '@/lib/data/AppDataContext'
import { formatRelativeTime } from '@/lib/formatRelativeTime'
import type { SymmetryPoint, TelemetryPoint } from '@/types'

const RECENT_SESSIONS_FOR_SYMMETRY = 6

function averageOf(values: number[]): number {
  return values.length === 0 ? 0 : Math.round(values.reduce((sum, v) => sum + v, 0) / values.length)
}

export function TelemetrySection({ initialPatientId }: { initialPatientId?: string }) {
  const { patients, sessions } = useAppData()
  const [patientId, setPatientId] = useState<string | undefined>(initialPatientId)
  const patient = patients.find((p) => p.id === patientId) ?? patients[0]

  const patientSessions = useMemo(
    () => sessions.filter((s) => s.patientId === patient?.id).sort((a, b) => a.completedAt - b.completedAt),
    [sessions, patient?.id],
  )
  const latestSession = patientSessions[patientSessions.length - 1]

  const trendData: TelemetryPoint[] = latestSession
    ? latestSession.reps.map((r) => ({
        t: r.rep,
        angle: r.angle,
        targetMin: latestSession.targetMin,
        targetMax: latestSession.targetMax,
      }))
    : []

  const symmetryData: SymmetryPoint[] = patientSessions.slice(-RECENT_SESSIONS_FOR_SYMMETRY).map((s, i) => ({
    session: `S${i + 1}`,
    left: averageOf(s.reps.map((r) => r.emgLeft)),
    right: averageOf(s.reps.map((r) => r.emgRight)),
  }))

  return (
    <Card className="p-7">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">Historical Telemetry Review</h2>
          <p className="text-[13px] text-ink-faint">Multi-session trend vs. prescribed rehabilitation corridor</p>
        </div>
        {patients.length > 0 && (
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
        )}
      </div>

      {patients.length === 0 ? (
        <p className="rounded-xl bg-surface-secondary p-6 text-center text-[13px] text-ink-faint">
          No patients have signed in yet — telemetry will be reviewable once someone completes a session.
        </p>
      ) : patientSessions.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl bg-surface-secondary p-10 text-center">
          <LineChart className="h-6 w-6 text-ink-faint" />
          <p className="text-[14px] font-medium text-ink">No completed sessions yet</p>
          <p className="max-w-xs text-[13px] text-ink-faint">
            {patient?.name} hasn't finished a live session. Data appears here the moment they hit "End Session & Sync Data".
          </p>
        </div>
      ) : (
        <>
          <p className="mb-4 text-[12px] text-ink-faint">
            Latest session: <span className="font-medium text-ink-muted">{latestSession.exerciseTitle}</span> ·{' '}
            {formatRelativeTime(latestSession.completedAt)} · {latestSession.reps.length} reps recorded
          </p>
          <div className="grid grid-cols-1 gap-8 xl:grid-cols-2">
            <div>
              <p className="mb-3 text-[13px] font-medium text-ink-muted">Joint Angle Trajectory — {patient?.name}</p>
              <TrendChart data={trendData} />
            </div>
            <div>
              <p className="mb-3 text-[13px] font-medium text-ink-muted">
                Bilateral Muscle Symmetry (% MVC, last {symmetryData.length} session{symmetryData.length === 1 ? '' : 's'})
              </p>
              <SymmetryBarChart data={symmetryData} />
            </div>
          </div>
        </>
      )}
    </Card>
  )
}
