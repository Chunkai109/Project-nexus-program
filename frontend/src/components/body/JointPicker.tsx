import { BodySilhouette } from './BodySilhouette'
import { JOINT_PRESETS, NODE_POSITIONS } from '@/lib/joints'

/**
 * One tap picks a whole joint (both underlying sensor nodes at once), rather
 * than requiring two separate taps on raw sensor dots. The confirmed angle
 * this produces is exactly the same nodeA/nodeB pair shape as before.
 */
export function JointPicker({
  selectedJointId,
  onSelect,
  height = 220,
}: {
  selectedJointId: string | null
  onSelect: (jointId: string) => void
  height?: number
}) {
  return (
    <svg viewBox="0 0 200 400" style={{ height, width: height / 2 }} className="mx-auto">
      <BodySilhouette />
      {JOINT_PRESETS.map((preset) => {
        const pos = NODE_POSITIONS[preset.markerNodeId]
        if (!pos) return null
        const isSelected = selectedJointId === preset.id
        const color = isSelected ? 'var(--color-accent)' : 'var(--color-ink-faint)'
        return (
          <g
            key={preset.id}
            transform={`translate(${pos.x}, ${pos.y})`}
            onClick={() => onSelect(preset.id)}
            className="cursor-pointer"
          >
            {isSelected && <circle r={13} fill="none" stroke="var(--color-accent)" strokeOpacity={0.35} strokeWidth={2} />}
            <circle
              r={isSelected ? 9 : 7}
              fill="var(--color-surface)"
              stroke={color}
              strokeWidth={isSelected ? 2.5 : 2}
              style={{ transition: 'r 150ms ease' }}
            />
          </g>
        )
      })}
    </svg>
  )
}
