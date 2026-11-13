import { Card } from '@/components/ui/Card'
import { ExerciseFormFields } from './ExerciseFormFields'
import { useAppData } from '@/lib/data/AppDataContext'
import { useExerciseForm } from '@/lib/useExerciseForm'
import { podLabel } from '@/lib/podUtils'
import type { AngleConfig } from '@/types'
import { PageHeader } from './ui/PageHeader'

export function describeAngleConfigs(configs: AngleConfig[]): string {
  if (configs.length === 0) return 'No angles configured'
  const first = `${podLabel(configs[0].nodeA)} ↔ ${podLabel(configs[0].nodeB)} (${configs[0].targetMin}°–${configs[0].targetMax}°)`
  return configs.length === 1 ? first : `${first} +${configs.length - 1} more`
}

/**
 * The "New preset" form. Presets are exercises not assigned to anyone; the
 * physio copies one into a patient's own plan from that patient's Exercise
 * plan tab. The list of presets is PresetListView.
 */
export function ProtocolBuilder({ onDone }: { onDone: (savedId?: string) => void }) {
  const { addExercise } = useAppData()
  const formCtl = useExerciseForm()

  function handleSave() {
    if (!formCtl.canSave) return
    const saved = addExercise(formCtl.buildPayload())
    onDone(saved.id)
  }

  return (
    <>
      <PageHeader title="New preset" subtitle="Set the range, limits and notes this preset starts every patient plan with." />
      <Card className="p-6">
        <ExerciseFormFields {...formCtl} mode="preset" onSave={handleSave} onCancel={() => onDone()} saveLabel="Save preset" />
      </Card>
    </>
  )
}
