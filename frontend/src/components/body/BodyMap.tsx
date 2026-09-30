import { clsx } from 'clsx'
import { BodySilhouette } from './BodySilhouette'
import type { Pod } from '@/types'

// Positioned along the right arm (see BodySilhouette's right-arm path:
// shoulder (130,70) -> elbow (160,90) -> wrist (166,160)) to match the real
// single-arm bicep-curl rig: bicep EMG pod near the shoulder end, forearm IMU
// pod near the wrist end, the upper-tricep IMU pod at the elbow between them,
// and the two haptic motors bracketing that span.
const POD_POSITIONS: Record<number, { x: number; y: number }> = {
  1: { x: 141, y: 77 }, // Bicep EMG
  15: { x: 150, y: 83 }, // Corridor motor
  3: { x: 158, y: 89 }, // Upper tricep / upper-arm IMU
  2: { x: 162, y: 118 }, // Forearm IMU
  16: { x: 165, y: 143 }, // Fault motor
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
  /** One pod id, several at once (the two haptic motors can pulse independently), or null/none active. */
  hapticPodId?: number | number[] | null
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
        const isHaptic = Array.isArray(hapticPodId) ? hapticPodId.includes(pod.id) : hapticPodId === pod.id
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
