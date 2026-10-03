import { useMemo, useState } from 'react'
import { ChevronDown, Ruler, Weight, ClipboardList, Pill } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { TrendChart } from '@/components/charts/TrendChart'
import { SymmetryBarChart } from '@/components/charts/SymmetryBarChart'
import { HoverExplain } from '@/components/ui/HoverExplain'
import { useAppData } from '@/lib/data/AppDataContext'
import { formatRelativeTime } from '@/lib/formatRelativeTime'
import { getDummyMedicalProfile } from '@/lib/dummyMedicalProfile'
import { getDummySessionHistory } from '@/lib/dummySessionHistory'
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
  const hasRealSessions = patientSessions.length > 0

  // No real completed session yet -- fall back to deterministic placeholder
  // telemetry (see dummySessionHistory.ts) so the charts below have
  // something representative to show instead of an empty state. Stops
  // being used the instant this patient completes a real session.
  const dummyHistory = !hasRealSessions && patient ? getDummySessionHistory(patient.id) : null

  const trendData: TelemetryPoint[] = hasRealSessions
    ? latestSession.reps.map((r) => ({
        t: r.rep,
        angle: r.angle,
        targetMin: latestSession.targetMin,
        targetMax: latestSession.targetMax,
      }))
    : (dummyHistory?.trendData ?? [])

  const symmetryData: SymmetryPoint[] = hasRealSessions
    ? patientSessions.slice(-RECENT_SESSIONS_FOR_SYMMETRY).map((s, i) => ({
        session: `S${i + 1}`,
        left: averageOf(s.reps.map((r) => r.emgLeft)),
        right: averageOf(s.reps.map((r) => r.emgRight)),
      }))
    : (dummyHistory?.symmetryData ?? [])

  const profile = patient ? getDummyMedicalProfile(patient.id) : null

  return (
    <>
      {profile && (
        <Card className="mb-6 p-7">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-[15px] font-semibold text-ink">Patient Profile — {patient?.name}</h2>
            <HoverExplain explanation="This app has no real medical intake form yet — these fields are placeholder data derived from the patient's id, not an actual clinical record.">
              <Badge tone="amber">Demo data — not a real medical record</Badge>
            </HoverExplain>
          </div>
          <div className="mb-5 flex flex-wrap gap-6">
            <div className="flex items-center gap-2">
              <Ruler className="h-4 w-4 text-ink-faint" />
              <span className="text-[13px] text-ink-muted">Height: {profile.heightCm} cm</span>
            </div>
            <div className="flex items-center gap-2">
              <Weight className="h-4 w-4 text-ink-faint" />
              <span className="text-[13px] text-ink-muted">Weight: {profile.weightKg} kg</span>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-ink-faint">
                <ClipboardList className="h-3.5 w-3.5" />
                Medical History
              </p>
              <ul className="flex flex-col gap-1.5">
                {profile.medicalHistory.map((item) => (
                  <li key={item} className="text-[13px] text-ink-muted">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-ink-faint">
                <Pill className="h-3.5 w-3.5" />
                Prescribed Medications
              </p>
              <ul className="flex flex-col gap-1.5">
                {profile.prescribedMedications.map((item) => (
                  <li key={item} className="text-[13px] text-ink-muted">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      )}

      <Card className="p-7">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">Historical Telemetry Review</h2>
            <p className="text-[13px] text-ink-faint">Multi-session trend vs. prescribed rehabilitation corridor</p>
          </div>
          {patients.length > 0 && (
            <HoverExplain explanation="Switch the charts below to a different patient's telemetry history.">
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
          )}
        </div>

      {patients.length === 0 ? (
        <p className="rounded-xl bg-surface-secondary p-6 text-center text-[13px] text-ink-faint">
          No patients have signed in yet — telemetry will be reviewable once someone completes a session.
        </p>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            {hasRealSessions ? (
              <p className="text-[12px] text-ink-faint">
                Latest session: <span className="font-medium text-ink-muted">{latestSession.exerciseTitle}</span> ·{' '}
                {formatRelativeTime(latestSession.completedAt)} · {latestSession.reps.length} reps recorded
              </p>
            ) : (
              <p className="text-[12px] text-ink-faint">
                {patient?.name} hasn't completed a real session yet — showing placeholder demo telemetry below.
              </p>
            )}
            {!hasRealSessions && dummyHistory && (
              <HoverExplain
                explanation={`${patient?.name} hasn't finished a live session yet, so there's no real telemetry to show — these charts are placeholder data derived from their id, not an actual recorded session. Real data appears here the moment they hit "End Session & Sync Data".`}
              >
                <Badge tone="amber">Demo data — not a real session</Badge>
              </HoverExplain>
            )}
          </div>
          <div className="grid grid-cols-1 gap-8 xl:grid-cols-2">
            <HoverExplain explanation="Peak flexion angle on every rep of the most recent session, plotted against the prescribed target corridor (shaded band). Points outside the band mean that rep under- or over-shot the protocol's ROM target.">
              <div>
                <p className="mb-3 text-[13px] font-medium text-ink-muted">Joint Angle Trajectory — {patient?.name}</p>
                <TrendChart data={trendData} />
              </div>
            </HoverExplain>
            <HoverExplain explanation="Average EMG activation (% MVC) per side across recent sessions. A left/right gap that persists or widens over time can signal compensation or unilateral weakness.">
              <div>
                <p className="mb-3 text-[13px] font-medium text-ink-muted">
                  Bilateral Muscle Symmetry (% MVC, last {symmetryData.length} session{symmetryData.length === 1 ? '' : 's'})
                </p>
                <SymmetryBarChart data={symmetryData} />
              </div>
            </HoverExplain>
          </div>
        </>
      )}
      </Card>
    </>
  )
}
