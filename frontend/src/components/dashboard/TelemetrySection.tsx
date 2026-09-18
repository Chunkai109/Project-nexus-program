import { useState } from 'react'
import { ChevronDown, Info } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { TrendChart } from '@/components/charts/TrendChart'
import { SymmetryBarChart } from '@/components/charts/SymmetryBarChart'
import { useAppData } from '@/lib/data/AppDataContext'
import { SYMMETRY_HISTORY, TELEMETRY_HISTORY } from '@/lib/mockData'

export function TelemetrySection({ initialPatientId }: { initialPatientId?: string }) {
  const { patients } = useAppData()
  const [patientId, setPatientId] = useState<string | undefined>(initialPatientId)
  const patient = patients.find((p) => p.id === patientId) ?? patients[0]

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
      ) : (
        <>
          <div className="mb-4 flex items-start gap-2 rounded-lg bg-surface-secondary p-3 text-[12px] text-ink-faint">
            <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            Sample trend data shown below — per-session history will populate here once {patient?.name ?? 'this patient'}{' '}
            completes tracked live sessions.
          </div>
          <div className="grid grid-cols-1 gap-8 xl:grid-cols-2">
            <div>
              <p className="mb-3 text-[13px] font-medium text-ink-muted">Joint Angle Trajectory — {patient?.name}</p>
              <TrendChart data={TELEMETRY_HISTORY} />
            </div>
            <div>
              <p className="mb-3 text-[13px] font-medium text-ink-muted">Bilateral Muscle Symmetry (% MVC across sessions)</p>
              <SymmetryBarChart data={SYMMETRY_HISTORY} />
            </div>
          </div>
        </>
      )}
    </Card>
  )
}
