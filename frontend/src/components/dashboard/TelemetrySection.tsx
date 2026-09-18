import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'
import { TrendChart } from '@/components/charts/TrendChart'
import { SymmetryBarChart } from '@/components/charts/SymmetryBarChart'
import { PATIENT_ROSTER, SYMMETRY_HISTORY, TELEMETRY_HISTORY } from '@/lib/mockData'

export function TelemetrySection({ initialPatientId }: { initialPatientId?: string }) {
  const [patientId, setPatientId] = useState(initialPatientId ?? PATIENT_ROSTER[0].id)
  const patient = PATIENT_ROSTER.find((p) => p.id === patientId) ?? PATIENT_ROSTER[0]

  return (
    <GlassCard className="p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">Historical Telemetry Review</h2>
          <p className="text-xs text-ink-faint">Multi-session trend vs. prescribed rehabilitation corridor</p>
        </div>
        <div className="relative flex items-center gap-2 rounded-lg border border-border bg-white/[0.03] px-3 py-2">
          <span className="text-xs text-ink-faint">Patient:</span>
          <select
            value={patientId}
            onChange={(e) => setPatientId(e.target.value)}
            className="appearance-none bg-transparent pr-5 text-sm font-medium text-ink outline-none"
          >
            {PATIENT_ROSTER.map((p) => (
              <option key={p.id} value={p.id} className="bg-surface text-ink">
                {p.name} — {p.condition}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 h-3.5 w-3.5 text-ink-faint" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-medium text-ink-muted">
            Joint Angle Trajectory — {patient.name} <span className="text-ink-faint">({patient.condition})</span>
          </p>
          <TrendChart data={TELEMETRY_HISTORY} />
        </div>
        <div>
          <p className="mb-2 text-xs font-medium text-ink-muted">Bilateral Muscle Symmetry (% MVC across sessions)</p>
          <SymmetryBarChart data={SYMMETRY_HISTORY} />
        </div>
      </div>
    </GlassCard>
  )
}
