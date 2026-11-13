import { BodyModel3D, type BodyMarker3D } from './BodyModel3D'
import { MEASURED_MUSCLE_ID } from './measured'
import { MUSCLE_GROUPS } from '@/lib/muscles'
import type { BodyRegion } from '@/lib/bodyRegion'

/**
 * The muscle step of the exercise editor, on the 3D mannequin. Muscles are
 * shown as areas on the body. Only the right bicep can be picked on the model,
 * because it is the only muscle with a sensor; the rest are grey and say so
 * on hover. The group dropdown under it, and the muscle dropdown beside it,
 * reach every muscle from the keyboard.
 */
export function MuscleGroupPicker({
  selectedGroupId,
  selectedMuscleId,
  onSelect,
  onSelectMuscle,
  bodyRegion,
  height = 280,
}: {
  selectedGroupId: string | null
  selectedMuscleId: string | null
  onSelect: (groupId: string) => void
  /** Called when a muscle is picked on the model itself. */
  onSelectMuscle: (groupId: string, muscleId: string) => void
  bodyRegion: BodyRegion
  height?: number
}) {
  const markers: BodyMarker3D[] = MUSCLE_GROUPS.flatMap((g) =>
    g.muscles.map((m) => ({
      id: m.id,
      kind: 'muscle' as const,
      label: m.id === MEASURED_MUSCLE_ID ? `${m.label} (Pod 1)` : m.label,
      selectable: m.id === MEASURED_MUSCLE_ID,
      emphasised: g.id === selectedGroupId,
    })),
  )
  return (
    <div className="flex flex-col gap-3">
      <BodyModel3D
        mode="editor"
        bodyRegion={bodyRegion}
        markers={markers}
        selected={selectedMuscleId}
        onSelect={(id) => {
          const group = MUSCLE_GROUPS.find((g) => g.muscles.some((m) => m.id === id))
          if (group) onSelectMuscle(group.id, id)
        }}
        height={height}
      />
      <label className="block">
        <span className="mb-1 block text-[13px] font-medium text-ink-muted">Muscle group</span>
        <select
          value={selectedGroupId ?? ''}
          onChange={(e) => onSelect(e.target.value)}
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[14px] text-ink"
        >
          <option value="" disabled>
            Select a muscle group…
          </option>
          {MUSCLE_GROUPS.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
