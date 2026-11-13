import { useState } from 'react'
import { Card } from '@/components/ui/Card'
import { ExerciseFormFields } from './ExerciseFormFields'
import { useAppData } from '@/lib/data/AppDataContext'
import { useExerciseForm } from '@/lib/useExerciseForm'

/**
 * The same fields ProtocolBuilder's "New Exercise" form offers, reached
 * instead from the "Edit Exercise" button on that exercise's Optimization
 * Analytics page.
 */
export function ExerciseFineTune({ exerciseId }: { exerciseId: string }) {
  const { exercises, updateExercise } = useAppData()
  const exercise = exercises.find((e) => e.id === exerciseId)
  const {
    form,
    setForm,
    toggleTag,
    chooseBodyRegion,
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
  } = useExerciseForm(exercise)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  if (!exercise) {
    return (
      <Card className="p-7 text-center">
        <p className="text-[14px] text-ink-muted">This exercise no longer exists — it may have just been deleted.</p>
      </Card>
    )
  }

  async function handleSave() {
    if (!canSave || saving) return
    setSaving(true)
    setSaveError(null)
    try {
      await updateExercise(exerciseId, buildPayload())
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    } catch {
      setSaveError("Couldn't save. Your changes are still here, try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="p-7">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">Edit Exercise</h2>
          <p className="text-[13px] text-ink-faint">Define biomechanical thresholds prescribed for this exercise</p>
        </div>
        {saved && <span className="text-[13px] font-medium text-emerald-ink">Saved.</span>}
      </div>
      <ExerciseFormFields
        form={form}
        setForm={setForm}
        mode="preset"
        saving={saving}
        saveError={saveError}
        toggleTag={toggleTag}
        chooseBodyRegion={chooseBodyRegion}
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
        saveLabel="Save Changes"
      />
    </Card>
  )
}
