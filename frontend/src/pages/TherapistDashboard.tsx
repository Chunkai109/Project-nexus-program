import { useState } from 'react'
import { PageShell } from '@/components/layout/PageShell'
import { PhysioSidebar } from '@/components/layout/PhysioSidebar'
import { ProtocolBuilder } from '@/components/dashboard/ProtocolBuilder'
import { TelemetrySection } from '@/components/dashboard/TelemetrySection'
import { PatientRosterGrid } from '@/components/dashboard/PatientRosterGrid'
import { GlassCard } from '@/components/ui/GlassCard'
import { Settings } from 'lucide-react'

export function TherapistDashboard() {
  const [tab, setTab] = useState('creator')
  const [focusPatientId, setFocusPatientId] = useState<string | undefined>(undefined)

  return (
    <PageShell className="flex">
      <PhysioSidebar active={tab} onSelect={setTab} />

      <main className="scroll-slim flex-1 overflow-y-auto px-8 py-8">
        {tab === 'roster' && (
          <>
            <div className="mb-6">
              <h1 className="text-2xl font-bold text-ink">Patient Roster</h1>
              <p className="mt-1 text-sm text-ink-muted">Active rehabilitation patients under your care.</p>
            </div>
            <PatientRosterGrid
              onOpenPatient={(id) => {
                setFocusPatientId(id)
                setTab('analytics')
              }}
            />
          </>
        )}

        {tab === 'creator' && (
          <>
            <div className="mb-6">
              <h1 className="text-2xl font-bold text-ink">Exercise Creator</h1>
              <p className="mt-1 text-sm text-ink-muted">
                Build a rehabilitation protocol and review how patients are tracking against it.
              </p>
            </div>
            <div className="flex flex-col gap-6">
              <ProtocolBuilder />
              <TelemetrySection initialPatientId={focusPatientId} />
            </div>
          </>
        )}

        {tab === 'analytics' && (
          <>
            <div className="mb-6">
              <h1 className="text-2xl font-bold text-ink">Session Analytics</h1>
              <p className="mt-1 text-sm text-ink-muted">Deep-dive into a single patient's telemetry history.</p>
            </div>
            <TelemetrySection initialPatientId={focusPatientId} />
          </>
        )}

        {tab === 'settings' && (
          <>
            <div className="mb-6">
              <h1 className="text-2xl font-bold text-ink">Settings</h1>
              <p className="mt-1 text-sm text-ink-muted">Practice preferences and account configuration.</p>
            </div>
            <GlassCard className="flex flex-col items-center gap-3 p-12 text-center">
              <Settings className="h-8 w-8 text-ink-faint" />
              <p className="text-sm text-ink-muted">Practice settings are coming in a future iteration of this draft.</p>
            </GlassCard>
          </>
        )}
      </main>
    </PageShell>
  )
}
