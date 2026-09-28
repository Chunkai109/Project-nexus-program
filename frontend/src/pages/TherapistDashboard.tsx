import { useState } from 'react'
import { PageShell } from '@/components/layout/PageShell'
import { PhysioSidebar } from '@/components/layout/PhysioSidebar'
import { ProtocolBuilder } from '@/components/dashboard/ProtocolBuilder'
import { ExerciseOptimizationMetrics } from '@/components/dashboard/ExerciseOptimizationMetrics'
import { ExerciseFineTune } from '@/components/dashboard/ExerciseFineTune'
import { TelemetrySection } from '@/components/dashboard/TelemetrySection'
import { PatientRosterGrid } from '@/components/dashboard/PatientRosterGrid'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { HoverExplain } from '@/components/ui/HoverExplain'
import { useAppData } from '@/lib/data/AppDataContext'
import { ArrowLeft, Pencil, Settings, Trash2 } from 'lucide-react'

export function TherapistDashboard() {
  const { exercises, deleteExercise } = useAppData()
  const [tab, setTab] = useState('creator')
  const [selectedPatientId, setSelectedPatientId] = useState<string | undefined>()
  const [selectedExerciseId, setSelectedExerciseId] = useState<string | undefined>()
  const [pendingDeleteExercise, setPendingDeleteExercise] = useState(false)

  function openPatientAnalytics(patientId: string) {
    setSelectedPatientId(patientId)
    setTab('analytics')
  }

  function openExerciseAnalytics(exerciseId: string) {
    setSelectedExerciseId(exerciseId)
    setPendingDeleteExercise(false)
    setTab('exercise-analytics')
  }

  function openExerciseFineTune(exerciseId: string) {
    setSelectedExerciseId(exerciseId)
    setTab('exercise-finetune')
  }

  function confirmDeleteExercise() {
    if (!selectedExerciseId) return
    deleteExercise(selectedExerciseId)
    setPendingDeleteExercise(false)
    setTab('creator')
  }

  const selectedExercise = exercises.find((e) => e.id === selectedExerciseId)

  return (
    <PageShell className="flex flex-col lg:flex-row">
      <PhysioSidebar active={tab} onSelect={setTab} />

      <main className="scroll-slim flex-1 overflow-y-auto px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-10">
        {tab === 'roster' && (
          <>
            <div className="mb-10">
              <h1 className="text-[28px] font-semibold tracking-tight text-ink">Patient Roster</h1>
              <p className="mt-1.5 text-[15px] text-ink-muted">
                Patients who have signed in to SmartPhysio. Select one to review their session history.
              </p>
            </div>
            <PatientRosterGrid onSelectPatient={openPatientAnalytics} />
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
            <ProtocolBuilder onSelectExercise={openExerciseAnalytics} />
          </>
        )}

        {tab === 'exercise-analytics' && selectedExerciseId && (
          <>
            <HoverExplain explanation="Return to the Exercise Protocols list." className="mb-6">
              <Button variant="ghost" size="sm" onClick={() => setTab('creator')}>
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to Exercise Creator
              </Button>
            </HoverExplain>
            <div className="mb-10 flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="text-[28px] font-semibold tracking-tight text-ink">{selectedExercise?.title ?? 'Exercise'}</h1>
                <p className="mt-1.5 text-[15px] text-ink-muted">Optimization analytics for this exercise.</p>
              </div>
              {pendingDeleteExercise ? (
                <div className="flex items-center gap-2">
                  <span className="text-[13px] text-ink-muted">Delete this exercise?</span>
                  <HoverExplain explanation="Keep this exercise — cancels the delete.">
                    <Button variant="ghost" size="sm" onClick={() => setPendingDeleteExercise(false)}>
                      Cancel
                    </Button>
                  </HoverExplain>
                  <HoverExplain explanation="Permanently delete this exercise. Patients it's assigned to will no longer see it.">
                    <Button variant="danger" size="sm" onClick={confirmDeleteExercise}>
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </Button>
                  </HoverExplain>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <HoverExplain explanation="Open this exercise's fields to change its thresholds, targets, or assignment.">
                    <Button size="sm" onClick={() => openExerciseFineTune(selectedExerciseId)}>
                      <Pencil className="h-3.5 w-3.5" />
                      Edit Exercise
                    </Button>
                  </HoverExplain>
                  <HoverExplain explanation="Ask for confirmation before permanently deleting this exercise.">
                    <Button variant="danger" size="sm" onClick={() => setPendingDeleteExercise(true)}>
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete Exercise
                    </Button>
                  </HoverExplain>
                </div>
              )}
            </div>
            {selectedExercise ? (
              <ExerciseOptimizationMetrics key={selectedExerciseId} exercise={selectedExercise} />
            ) : (
              <Card className="p-7 text-center">
                <p className="text-[14px] text-ink-muted">This exercise no longer exists — it may have just been deleted.</p>
              </Card>
            )}
          </>
        )}

        {tab === 'exercise-finetune' && selectedExerciseId && (
          <>
            <HoverExplain explanation="Return to this exercise's Optimization Analytics without saving further changes." className="mb-6">
              <Button variant="ghost" size="sm" onClick={() => setTab('exercise-analytics')}>
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to Analytics
              </Button>
            </HoverExplain>
            <div className="mb-10">
              <h1 className="text-[28px] font-semibold tracking-tight text-ink">{selectedExercise?.title ?? 'Exercise'}</h1>
              <p className="mt-1.5 text-[15px] text-ink-muted">Fine-tune thresholds prescribed for this exercise.</p>
            </div>
            <ExerciseFineTune key={selectedExerciseId} exerciseId={selectedExerciseId} />
          </>
        )}

        {tab === 'analytics' && (
          <>
            <HoverExplain explanation="Return to the Patient Roster list." className="mb-6">
              <Button variant="ghost" size="sm" onClick={() => setTab('roster')}>
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to Patient Roster
              </Button>
            </HoverExplain>
            <div className="mb-10">
              <h1 className="text-[28px] font-semibold tracking-tight text-ink">Session Analytics</h1>
              <p className="mt-1.5 text-[15px] text-ink-muted">Deep-dive into a single patient's telemetry history.</p>
            </div>
            <TelemetrySection key={selectedPatientId} initialPatientId={selectedPatientId} />
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
