import { BodySilhouette } from './BodySilhouette'
import { MUSCLE_OPTIONS, NODE_POSITIONS } from '@/lib/joints'
import type { MuscleEmgTarget, PodId } from '@/types'

/**
 * One tap selects a muscle to set a target %MVC for; muscles that already
 * have a confirmed target show it right on the marker, so the physio can see
 * every muscle's characteristic at a glance instead of one global number.
 */
export function MuscleEmgPicker({
  targets,
  selectedMuscleId,
  onSelect,
  height = 220,
}: {
  targets: MuscleEmgTarget[]
  selectedMuscleId: PodId | null
  onSelect: (podId: PodId) => void
  height?: number
}) {
  return (
    <svg viewBox="0 0 200 400" style={{ height, width: height / 2 }} className="mx-auto">
      <BodySilhouette />
      {MUSCLE_OPTIONS.map((muscle) => {
        const pos = NODE_POSITIONS[muscle.id]
        if (!pos) return null
        const target = targets.find((t) => t.podId === muscle.id)
        const isSelected = selectedMuscleId === muscle.id
        const color = isSelected ? 'var(--color-accent)' : target ? 'var(--color-emerald)' : 'var(--color-ink-faint)'
        return (
          <g
            key={muscle.id}
            transform={`translate(${pos.x}, ${pos.y})`}
            onClick={() => onSelect(muscle.id)}
            className="cursor-pointer"
          >
            {isSelected && <circle r={13} fill="none" stroke="var(--color-accent)" strokeOpacity={0.35} strokeWidth={2} />}
            <circle
              r={isSelected || target ? 9 : 7}
              fill="var(--color-surface)"
              stroke={color}
              strokeWidth={isSelected || target ? 2.5 : 2}
              style={{ transition: 'r 150ms ease' }}
            />
            {target && (
              <text
                y={-16}
                textAnchor="middle"
                className="select-none font-semibold"
                style={{ fontSize: 10, fill: 'var(--color-emerald)' }}
              >
                {target.targetMvc}%
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}
