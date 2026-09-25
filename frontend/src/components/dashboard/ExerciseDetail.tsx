import { useState } from 'react'
import { Save } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { ExerciseFormFields } from './ExerciseFormFields'
import { ExerciseOptimizationMetrics } from './ExerciseOptimizationMetrics'
import { useAppData } from '@/lib/data/AppDataContext'
import { useExerciseForm } from '@/lib/useExerciseForm'

/**
 * Fine-tune a single exercise (the same fields ProtocolBuilder's "New
 * Exercise" form offers) and review the optimization metrics for just that
 * exercise. Reached by clicking a protocol in the Exercise Creator list.
 */
export function ExerciseDetail({ exerciseId }: { exerciseId: string }) {
  const { exercises, patients, updateExercise } = useAppData()
  const exercise = exercises.find((e) => e.id === exerciseId)
  const {
    form,
    setForm,
    toggleTag,
    toggleDraftNode,
    draftValid,
    draftSideMismatch,
    canSave,
    confirmAngle,
    removeAngleConfig,
    loadAngleIntoDraft,
    buildPayload,
  } = useExerciseForm(exercise)
  const [saved, setSaved] = useState(false)

  if (!exercise) {
    return (
      <Card className="p-7 text-center">
        <p className="text-[14px] text-ink-muted">This exercise no longer exists — it may have just been deleted.</p>
      </Card>
    )
  }

  function handleSave() {
    if (!canSave) return
    updateExercise(exerciseId, buildPayload())
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-7">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">Fine-Tune Exercise</h2>
            <p className="text-[13px] text-ink-faint">Define biomechanical thresholds prescribed for this exercise</p>
          </div>
          <div className="flex items-center gap-3">
            {saved && <span className="text-[13px] font-medium text-emerald">Saved.</span>}
            <Button size="sm" onClick={handleSave} disabled={!canSave}>
              <Save className="h-3.5 w-3.5" />
              Save Changes
            </Button>
          </div>
        </div>
        <ExerciseFormFields
          form={form}
          setForm={setForm}
          patients={patients}
          toggleTag={toggleTag}
          toggleDraftNode={toggleDraftNode}
          draftValid={draftValid}
          draftSideMismatch={draftSideMismatch}
          confirmAngle={confirmAngle}
          removeAngleConfig={removeAngleConfig}
          loadAngleIntoDraft={loadAngleIntoDraft}
        />
      </Card>

      <ExerciseOptimizationMetrics exercise={exercise} />
    </div>
  )
}
