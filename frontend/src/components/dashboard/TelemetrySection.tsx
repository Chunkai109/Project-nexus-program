import { useCallback, useMemo, useRef, useState } from 'react'
import { UserRound } from 'lucide-react'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { PatientExercisePlan } from '@/components/dashboard/PatientExercisePlan'
import { useAppData } from '@/lib/data/AppDataContext'
import { historyFor } from '@/lib/sessionStats'
import { PatientPageView } from './PatientPageView'
import { sessionsOf, statusOf } from './physioModel'
import { EmptyState, Skeleton } from './ui/States'

/**
 * The real patient page. Status comes from recorded sessions only. When the
 * patient has none yet, the Progress tab shows labelled demo history.
 */
export function TelemetrySection({
  initialPatientId,
  onDirtyChange,
  onOpenCreator,
  onBack,
}: {
  initialPatientId?: string
  /** Tells the dashboard the plan editor has unsaved changes, so leaving the page can ask first. */
  onDirtyChange?: (dirty: boolean) => void
  onOpenCreator: () => void
  onBack: () => void
}) {
  const { patients, sessions, exercises, loading } = useAppData()
  const patient = patients.find((p) => p.id === initialPatientId) ?? patients[0]

  const dirtyRef = useRef(false)
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)
  const handleDirtyChange = useCallback(
    (dirty: boolean) => {
      dirtyRef.current = dirty
      onDirtyChange?.(dirty)
    },
    [onDirtyChange],
  )
  const guard = useCallback((action: () => void) => {
    if (dirtyRef.current) setPendingAction(() => action)
    else action()
  }, [])

  const data = useMemo(() => {
    if (!patient) return null
    const real = sessionsOf(patient.id, sessions)
    const { status, reason } = statusOf(real)
    const { sessions: history, isDemo } = historyFor(patient.id, sessions)
    const plans = exercises.filter((e) => e.assignedPatientId === patient.id).sort((a, b) => b.createdAt - a.createdAt)
    return { patient, status, reason, history, isDemo, plans, lastRealSessionAt: real.length ? real[real.length - 1].completedAt : null }
  }, [patient, sessions, exercises])

  if (loading)
    return (
      <div aria-busy="true" aria-label="Loading patient…" className="flex flex-col gap-6">
        <Skeleton className="h-24 w-full rounded-2xl" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-72 w-full rounded-2xl" />
      </div>
    )
  if (!data) return <EmptyState icon={UserRound} message="No patients yet. Patients appear here after their first sign-in." />

  return (
    <>
      <PatientPageView
        data={data}
        onBack={onBack}
        guard={guard}
        planPanel={<PatientExercisePlan key={data.patient.id} patient={data.patient} onDirtyChange={handleDirtyChange} onOpenCreator={onOpenCreator} />}
      />
      <ConfirmDialog
        open={pendingAction !== null}
        message="Discard unsaved changes?"
        cancelLabel="Keep editing"
        confirmLabel="Discard"
        danger
        onCancel={() => setPendingAction(null)}
        onConfirm={() => {
          const action = pendingAction
          setPendingAction(null)
          dirtyRef.current = false
          onDirtyChange?.(false)
          action?.()
        }}
      />
    </>
  )
}
