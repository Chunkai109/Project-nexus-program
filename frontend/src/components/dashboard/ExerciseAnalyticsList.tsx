import { ChevronRight } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { useAppData } from '@/lib/data/AppDataContext'
import { describeAngleConfigs } from './ProtocolBuilder'

/**
 * Mirrors the Exercise Protocols card's layout and row styling, but every
 * row here opens that exercise's Exercise Optimization Analytics page
 * instead of an edit form.
 */
export function ExerciseAnalyticsList({ onSelectExercise }: { onSelectExercise: (exerciseId: string) => void }) {
  const { exercises, patients } = useAppData()

  return (
    <Card className="p-7">
      <div className="mb-6">
        <h2 className="text-[15px] font-semibold text-ink">Exercise Optimization Analytics</h2>
        <p className="text-[13px] text-ink-faint">
          {exercises.length === 0
            ? 'Create a protocol above to start reviewing its optimization metrics here.'
            : 'Aggregate biomechanical performance to refine protocol thresholds. Select an exercise to view its analytics.'}
        </p>
      </div>

      {exercises.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl bg-surface-secondary py-14 text-center">
          <p className="text-[14px] font-medium text-ink">No exercises yet</p>
          <p className="max-w-xs text-[13px] text-ink-faint">
            Once you publish a protocol, its optimization analytics will appear here.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {exercises.map((ex) => {
            const assignedPatient = patients.find((p) => p.id === ex.assignedPatientId)
            return (
              <button
                key={ex.id}
                type="button"
                onClick={() => onSelectExercise(ex.id)}
                className="flex w-full items-center justify-between gap-4 rounded-xl bg-surface-secondary p-4 text-left transition-colors duration-200 hover:bg-surface-hover"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-[14px] font-semibold text-ink">{ex.title}</p>
                    <Badge tone="accent">{ex.sets}×{ex.reps}</Badge>
                    {assignedPatient ? (
                      <Badge tone="violet">{assignedPatient.name}</Badge>
                    ) : (
                      <span className="text-[12px] text-ink-faint">All Patients</span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-[13px] text-ink-faint">{describeAngleConfigs(ex.angleConfigs)}</p>
                </div>
                <ChevronRight className="h-4 w-4 flex-shrink-0 text-ink-faint" />
              </button>
            )
          })}
        </div>
      )}
    </Card>
  )
}
