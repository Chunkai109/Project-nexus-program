import { BodySilhouette } from './BodySilhouette'
import { MUSCLE_GROUP_NODES } from '@/lib/muscles'

/**
 * One tap on a stickman node reveals which muscle group it is (bilateral
 * regions like Shoulder or Arm have two nodes that both select the same
 * group); the specific muscle within that group is then picked from a
 * dropdown, not from the stickman itself.
 */
export function MuscleGroupPicker({
  selectedGroupId,
  onSelect,
  height = 220,
}: {
  selectedGroupId: string | null
  onSelect: (groupId: string) => void
  height?: number
}) {
  return (
    <svg viewBox="0 0 200 400" style={{ height, width: height / 2 }} className="mx-auto">
      <BodySilhouette />
      {MUSCLE_GROUP_NODES.map((node) => {
        const isSelected = selectedGroupId === node.groupId
        const color = isSelected ? 'var(--color-accent)' : 'var(--color-ink-faint)'
        return (
          <g
            key={node.id}
            transform={`translate(${node.x}, ${node.y})`}
            onClick={() => onSelect(node.groupId)}
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
