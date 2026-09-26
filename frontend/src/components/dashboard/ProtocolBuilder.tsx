import { useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { ExerciseFormFields } from './ExerciseFormFields'
import { useAppData } from '@/lib/data/AppDataContext'
import { useExerciseForm } from '@/lib/useExerciseForm'
import { podLabel } from '@/lib/podUtils'
import type { AngleConfig, Exercise } from '@/types'

export function describeAngleConfigs(configs: AngleConfig[]): string {
  if (configs.length === 0) return 'No angles configured'
  const first = `${podLabel(configs[0].nodeA)} ↔ ${podLabel(configs[0].nodeB)} (${configs[0].targetMin}°–${configs[0].targetMax}°)`
  return configs.length === 1 ? first : `${first} +${configs.length - 1} more`
}

export function ProtocolBuilder() {
  const { exercises, patients, addExercise, updateExercise, deleteExercise } = useAppData()
  const [mode, setMode] = useState<'list' | 'form'>('list')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const {
    form,
    setForm,
    resetForm,
    toggleTag,
    selectDraftJoint,
    draftValid,
    canSave,
    confirmAngle,
    removeAngleConfig,
    loadAngleIntoDraft,
    selectDraftMuscleGroup,
    selectDraftMuscle,
    setDraftMuscleEmgPct,
    confirmMuscleEmgTarget,
    removeMuscleEmgTarget,
    buildPayload,
  } = useExerciseForm()

  function confirmDelete(id: string) {
    deleteExercise(id)
    setPendingDeleteId(null)
  }

  function startCreate() {
    setEditingId(null)
    resetForm()
    setMode('form')
  }

  function startEdit(ex: Exercise) {
    setEditingId(ex.id)
    resetForm(ex)
    setMode('form')
  }

  function handleSave() {
    if (!canSave) return
    if (editingId) {
      updateExercise(editingId, buildPayload())
    } else {
      addExercise(buildPayload())
    }
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
    setMode('list')
  }

  if (mode === 'form') {
    return (
      <Card className="p-7">
        <div className="mb-6">
          <h2 className="text-[15px] font-semibold text-ink">{editingId ? 'Edit Exercise' : 'New Exercise'}</h2>
          <p className="text-[13px] text-ink-faint">Define biomechanical thresholds prescribed for this exercise</p>
        </div>
        <ExerciseFormFields
          form={form}
          setForm={setForm}
          patients={patients}
          toggleTag={toggleTag}
          selectDraftJoint={selectDraftJoint}
          draftValid={draftValid}
          confirmAngle={confirmAngle}
          removeAngleConfig={removeAngleConfig}
          loadAngleIntoDraft={loadAngleIntoDraft}
          selectDraftMuscleGroup={selectDraftMuscleGroup}
          selectDraftMuscle={selectDraftMuscle}
          setDraftMuscleEmgPct={setDraftMuscleEmgPct}
          confirmMuscleEmgTarget={confirmMuscleEmgTarget}
          removeMuscleEmgTarget={removeMuscleEmgTarget}
          canSave={canSave}
          onSave={handleSave}
          onCancel={() => setMode('list')}
          saveLabel={editingId ? 'Save Changes' : 'Save Protocol'}
        />
      </Card>
    )
  }

  return (
    <Card className="p-7">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">Exercise Protocols</h2>
          <p className="text-[13px] text-ink-faint">
            {exercises.length === 0
              ? 'Nothing created yet — patients see exactly what you publish here.'
              : `${exercises.length} protocol${exercises.length === 1 ? '' : 's'} visible to patients right now.`}
          </p>
        </div>
        <Button size="sm" onClick={startCreate}>
          <Plus className="h-3.5 w-3.5" />
          New Exercise
        </Button>
      </div>

      {exercises.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl bg-surface-secondary py-14 text-center">
          <p className="text-[14px] font-medium text-ink">No exercises yet</p>
          <p className="max-w-xs text-[13px] text-ink-faint">
            Create your first protocol and it will immediately appear on the patient's exercise list.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {exercises.map((ex) => {
            const assignedPatient = patients.find((p) => p.id === ex.assignedPatientId)
            return (
              <div key={ex.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl bg-surface-secondary p-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold text-ink">{ex.title}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Badge tone="accent">{ex.sets}×{ex.reps}</Badge>
                    {assignedPatient ? (
                      <Badge tone="violet">{assignedPatient.name}</Badge>
                    ) : (
                      <span className="text-[12px] text-ink-faint">All Patients</span>
                    )}
                  </div>
                  <p className="mt-1 truncate text-[13px] text-ink-faint">{describeAngleConfigs(ex.angleConfigs)}</p>
                </div>
                {pendingDeleteId === ex.id ? (
                  <div className="flex flex-shrink-0 items-center gap-2">
                    <span className="text-[13px] text-ink-muted">Delete this exercise?</span>
                    <Button variant="ghost" size="sm" onClick={() => setPendingDeleteId(null)}>
                      Cancel
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => confirmDelete(ex.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-shrink-0 gap-2">
                    <Button variant="ghost" size="sm" onClick={() => startEdit(ex)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setPendingDeleteId(ex.id)}>
                      <Trash2 className="h-3.5 w-3.5 text-crimson" />
                    </Button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      {saved && <p className="mt-4 text-center text-[13px] font-medium text-emerald">Saved.</p>}
    </Card>
  )
}
