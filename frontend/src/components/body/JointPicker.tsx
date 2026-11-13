import { BodyModel3D, type BodyMarker3D } from './BodyModel3D'
import { ARM_ONLY_NOTE, MEASURED_JOINT_ID, NOT_MEASURED } from './measured'
import { JOINT_PRESETS } from '@/lib/joints'
import type { BodyRegion } from '@/lib/bodyRegion'

/**
 * The joint step of the exercise editor, on the 3D mannequin. Only the right
 * elbow can be picked, because it is the only joint the pods measure; the
 * other joints are drawn grey and say so. With the elbow picked, a see-through
 * forearm swings through the target range and the range is drawn as an arc.
 * The dropdown under it does the same job from the keyboard.
 */
export function JointPicker({
  selectedJointId,
  onSelect,
  bodyRegion,
  targetRange,
  height = 280,
}: {
  selectedJointId: string | null
  onSelect: (jointId: string) => void
  bodyRegion: BodyRegion
  /** Shown as the arc and the moving forearm while the right elbow is selected. */
  targetRange?: { min: number; max: number }
  height?: number
}) {
  // Lower-body and core exercises have nothing this rig can measure.
  const armInScope = bodyRegion === 'upper' || bodyRegion === 'full'
  const markers: BodyMarker3D[] = JOINT_PRESETS.map((j) => ({
    id: j.id,
    kind: 'joint',
    label: j.id === MEASURED_JOINT_ID ? `${j.label} (Pods 2 and 3)` : j.label,
    selectable: armInScope && j.id === MEASURED_JOINT_ID,
  }))
  const elbowSelected = selectedJointId === MEASURED_JOINT_ID
  return (
    <div className="flex flex-col gap-3">
      <BodyModel3D
        mode="editor"
        bodyRegion={bodyRegion}
        markers={markers}
        selected={selectedJointId}
        onSelect={onSelect}
        targetRange={elbowSelected ? targetRange : undefined}
        elbowAngleDeg={0}
        height={height}
        note={armInScope ? undefined : ARM_ONLY_NOTE}
      />
      <label className="block">
        <span className="mb-1 block text-[13px] font-medium text-ink-muted">Joint</span>
        <select
          value={selectedJointId ?? ''}
          onChange={(e) => onSelect(e.target.value)}
          disabled={!armInScope}
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[14px] text-ink disabled:opacity-60"
        >
          <option value="" disabled>
            {armInScope ? 'Select a joint…' : ARM_ONLY_NOTE}
          </option>
          {JOINT_PRESETS.map((j) => (
            <option key={j.id} value={j.id} disabled={j.id !== MEASURED_JOINT_ID}>
              {j.id === MEASURED_JOINT_ID ? `${j.label} (Pods 2 and 3)` : `${j.label}: ${NOT_MEASURED}`}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
