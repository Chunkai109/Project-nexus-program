import { useCallback, useRef, useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { BackLink } from '@/components/dashboard/ui/BackLink'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { PageShell } from '@/components/layout/PageShell'
import { PhysioSidebar } from '@/components/layout/PhysioSidebar'
import { AdminViewBanner } from '@/components/layout/AdminViewBanner'
import { ProtocolBuilder } from '@/components/dashboard/ProtocolBuilder'
import { ExerciseOptimizationMetrics } from '@/components/dashboard/ExerciseOptimizationMetrics'
import { ExerciseFineTune } from '@/components/dashboard/ExerciseFineTune'
import { TelemetrySection } from '@/components/dashboard/TelemetrySection'
import { PatientRosterGrid } from '@/components/dashboard/PatientRosterGrid'
import { PresetListView } from '@/components/dashboard/PresetListView'
import { PageHeader } from '@/components/dashboard/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { useAppData } from '@/lib/data/AppDataContext'
import { useAuth } from '@/lib/AuthContext'

export function TherapistDashboard() {
  const { exercises, patients, sessions, loading, deleteExercise } = useAppData()
  const { user } = useAuth()
  const [tab, setTab] = useState('roster')
  const [selectedPatientId, setSelectedPatientId] = useState<string | undefined>()
  const [selectedExerciseId, setSelectedExerciseId] = useState<string | undefined>()
  const [pendingDeleteExercise, setPendingDeleteExercise] = useState(false)
  // Set while a patient plan editor has unsaved changes; leaving the patient page asks first.
  const planDirtyRef = useRef(false)
  const [pendingTab, setPendingTab] = useState<string | null>(null)
  const handlePlanDirty = useCallback((dirty: boolean) => {
    planDirtyRef.current = dirty
  }, [])
  function goToTab(next: string) {
    if (tab === 'analytics' && next !== 'analytics' && planDirtyRef.current) setPendingTab(next)
    else setTab(next)
  }

  function openPatient(patientId: string) {
    setSelectedPatientId(patientId)
    setTab('analytics')
  }

  function openPresetResults(exerciseId: string) {
    setSelectedExerciseId(exerciseId)
    setPendingDeleteExercise(false)
    setTab('exercise-analytics')
  }

  function openPresetEditor(exerciseId: string) {
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
    <PageShell fullWidth className="flex flex-col">
      {user?.role === 'admin' && <AdminViewBanner practiceId={user.practiceId} />}
      <PhysioSidebar active={tab} onSelect={goToTab} />

      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-10">
        {tab === 'roster' && (
          <>
            <PageHeader title="Patients" subtitle="Who needs you first, based on each patient's latest session." />
            <PatientRosterGrid onSelectPatient={openPatient} />
          </>
        )}

        {tab === 'creator' && (
          <PresetListView exercises={exercises} loading={loading} onNew={() => setTab('creator-new')} onView={openPresetResults} onEdit={openPresetEditor} />
        )}

        {tab === 'creator-new' && (
          <>
            <div className="mb-4">
              <BackLink label="Back to Exercise Creator" onClick={() => setTab('creator')} />
            </div>
            <ProtocolBuilder onDone={(id) => (id ? openPresetResults(id) : setTab('creator'))} />
          </>
        )}

        {tab === 'exercise-analytics' && selectedExerciseId && (
          <>
            <PageHeader
              above={<BackLink label="Back to Exercise Creator" onClick={() => setTab('creator')} />}
              title={selectedExercise?.title ?? 'Preset'}
              subtitle="Preset results"
              actions={
                selectedExercise && (
                  <>
                    <Button onClick={() => openPresetEditor(selectedExerciseId)}>
                      <Pencil className="h-4 w-4" aria-hidden />
                      Edit preset
                    </Button>
                    <Button variant="outline" className="text-crimson-ink" onClick={() => setPendingDeleteExercise(true)}>
                      <Trash2 className="h-4 w-4" aria-hidden />
                      Delete preset
                    </Button>
                  </>
                )
              }
            />
            {selectedExercise ? (
              <ExerciseOptimizationMetrics
                key={selectedExerciseId}
                exercise={selectedExercise}
                exercises={exercises}
                patients={patients}
                sessions={sessions}
                onOpenPatient={openPatient}
              />
            ) : (
              <Card className="p-7 text-center">
                <p className="text-[15px] text-ink-muted">This preset no longer exists. It may have just been deleted.</p>
              </Card>
            )}
          </>
        )}

        {tab === 'exercise-finetune' && selectedExerciseId && (
          <>
            <PageHeader
              above={<BackLink label="Back to preset results" onClick={() => setTab('exercise-analytics')} />}
              title={selectedExercise?.title ?? 'Preset'}
              subtitle="Edit this preset. Patient plans already copied from it don't change."
            />
            <ExerciseFineTune key={selectedExerciseId} exerciseId={selectedExerciseId} />
          </>
        )}

        {tab === 'analytics' && (
          <TelemetrySection
            key={selectedPatientId}
            initialPatientId={selectedPatientId}
            onDirtyChange={handlePlanDirty}
            onOpenCreator={() => goToTab('creator')}
            onBack={() => goToTab('roster')}
          />
        )}
      </main>
      <ConfirmDialog
        open={pendingDeleteExercise}
        message="Delete this preset? Patient plans copied from it stay as they are."
        cancelLabel="Keep preset"
        confirmLabel="Delete preset"
        danger
        onCancel={() => setPendingDeleteExercise(false)}
        onConfirm={confirmDeleteExercise}
      />
      <ConfirmDialog
        open={pendingTab !== null}
        message="Discard unsaved changes?"
        cancelLabel="Keep editing"
        confirmLabel="Discard"
        danger
        onCancel={() => setPendingTab(null)}
        onConfirm={() => {
          planDirtyRef.current = false
          if (pendingTab) setTab(pendingTab)
          setPendingTab(null)
        }}
      />
    </PageShell>
  )
}
