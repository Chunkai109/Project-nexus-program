import { clsx } from 'clsx'
import { BodySilhouette } from './BodySilhouette'
import type { Pod } from '@/types'

const POD_POSITIONS: Record<number, { x: number; y: number }> = {
  1: { x: 72, y: 205 },
  2: { x: 128, y: 205 },
  3: { x: 80, y: 268 },
  4: { x: 120, y: 268 },
  5: { x: 82, y: 328 },
  6: { x: 118, y: 328 },
}

const signalDot: Record<Pod['signal'], string> = {
  strong: 'var(--color-emerald)',
  weak: 'var(--color-amber)',
  offline: 'var(--color-crimson)',
}

export function BodyMap({
  pods,
  activePod,
  onSelect,
  hapticPodId,
  selectedPods,
  height = 200,
}: {
  pods: Pod[]
  activePod?: number | null
  onSelect?: (id: number) => void
  hapticPodId?: number | null
  /** Pods highlighted as a deliberate selection (e.g. the two reference nodes for an exercise's angle), distinct from live activity. */
  selectedPods?: number[]
  height?: number
}) {
  return (
    <svg viewBox="0 0 200 400" style={{ height, width: height / 2 }} className="mx-auto">
      <BodySilhouette />

      {/* Pod markers */}
      {pods.map((pod) => {
        const pos = POD_POSITIONS[pod.id]
        if (!pos) return null
        const isActive = activePod === pod.id
        const isHaptic = hapticPodId === pod.id
        const isSelected = selectedPods?.includes(pod.id) ?? false
        const color = isHaptic ? 'var(--color-crimson)' : isSelected ? 'var(--color-accent)' : signalDot[pod.signal]
        return (
          <g
            key={pod.id}
            transform={`translate(${pos.x}, ${pos.y})`}
            onClick={() => onSelect?.(pod.id)}
            className={onSelect ? 'cursor-pointer' : undefined}
          >
            {(pod.signal === 'strong' || isHaptic) && (
              <circle r={9} fill={color} opacity={0.3}>
                <animate attributeName="r" values={isHaptic ? '7;16;7' : '7;12;7'} dur={isHaptic ? '0.7s' : '2.4s'} repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.4;0;0.4" dur={isHaptic ? '0.7s' : '2.4s'} repeatCount="indefinite" />
              </circle>
            )}
            {isSelected && (
              <circle r={13} fill="none" stroke="var(--color-accent)" strokeOpacity={0.35} strokeWidth={2} />
            )}
            <circle
              r={isActive || isHaptic || isSelected ? 10 : 8}
              fill="var(--color-surface)"
              stroke={color}
              strokeWidth={isActive || isHaptic || isSelected ? 2.5 : 2}
              style={{ transition: 'r 150ms ease' }}
            />
            <text
              y={3}
              textAnchor="middle"
              className={clsx('select-none font-semibold')}
              style={{ fontSize: 9, fill: 'var(--color-ink)' }}
            >
              {pod.id}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
