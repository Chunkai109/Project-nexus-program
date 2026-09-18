import { useState } from 'react'
import { PageShell } from '@/components/layout/PageShell'
import { PhysioSidebar } from '@/components/layout/PhysioSidebar'
import { ProtocolBuilder } from '@/components/dashboard/ProtocolBuilder'
import { TelemetrySection } from '@/components/dashboard/TelemetrySection'
import { PatientRosterGrid } from '@/components/dashboard/PatientRosterGrid'
import { Card } from '@/components/ui/Card'
import { Settings } from 'lucide-react'

export function TherapistDashboard() {
  const [tab, setTab] = useState('creator')

  return (
    <PageShell className="flex">
      <PhysioSidebar active={tab} onSelect={setTab} />

      <main className="scroll-slim flex-1 overflow-y-auto px-10 py-10">
        {tab === 'roster' && (
          <>
            <div className="mb-10">
              <h1 className="text-[28px] font-semibold tracking-tight text-ink">Patient Roster</h1>
              <p className="mt-1.5 text-[15px] text-ink-muted">Patients who have signed in to SmartPhysio.</p>
            </div>
            <PatientRosterGrid />
          </>
        )}

        {tab === 'creator' && (
          <>
            <div className="mb-10">
              <h1 className="text-[28px] font-semibold tracking-tight text-ink">Exercise Creator</h1>
              <p className="mt-1.5 text-[15px] text-ink-muted">
                Build a rehabilitation protocol and review how patients are tracking against it.
              </p>
            </div>
            <div className="flex flex-col gap-6">
              <ProtocolBuilder />
              <TelemetrySection />
            </div>
          </>
        )}

        {tab === 'analytics' && (
          <>
            <div className="mb-10">
              <h1 className="text-[28px] font-semibold tracking-tight text-ink">Session Analytics</h1>
              <p className="mt-1.5 text-[15px] text-ink-muted">Deep-dive into a single patient's telemetry history.</p>
            </div>
            <TelemetrySection />
          </>
        )}

        {tab === 'settings' && (
          <>
            <div className="mb-10">
              <h1 className="text-[28px] font-semibold tracking-tight text-ink">Settings</h1>
              <p className="mt-1.5 text-[15px] text-ink-muted">Practice preferences and account configuration.</p>
            </div>
            <Card className="flex flex-col items-center gap-3 p-12 text-center">
              <Settings className="h-8 w-8 text-ink-faint" />
              <p className="text-sm text-ink-muted">Practice settings are coming in a future iteration of this draft.</p>
            </Card>
          </>
        )}
      </main>
    </PageShell>
  )
}
