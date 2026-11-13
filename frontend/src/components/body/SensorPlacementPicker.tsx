import { BodyModel3D, type BodyMarker3D } from './BodyModel3D'
import type { Pod } from '@/types'

/** Pods that have a fixed place on the right arm. Their positions are set in BodyModel3D (POD_PLACES). */
const PLACED = new Set([1, 2, 3, 15])

/**
 * Where each pod goes, on the 3D mannequin's right arm: Pod 1 on the bicep,
 * Pod 2 on the outer forearm, Pod 3 on the lower tricep near the elbow, and
 * the motor on the bicep. Each pod is labelled with its live status in words.
 * Picking a pod here highlights it in the list next to it, and the other way
 * round. The list is the keyboard route; the model is hidden from screen readers.
 */
export function SensorPlacementPicker({
  pods,
  activePodId,
  onSelect,
  height = 260,
}: {
  pods: Pod[]
  activePodId: number | null
  onSelect: (podId: number) => void
  height?: number
}) {
  const markers: BodyMarker3D[] = pods
    .filter((p) => PLACED.has(p.id))
    .map((p) => ({ id: `pod-${p.id}`, kind: 'pod', label: p.label, selectable: true, status: p.signal }))
  return (
    <BodyModel3D
      mode="setup"
      bodyRegion="upper"
      markers={markers}
      showPods
      selected={activePodId !== null ? `pod-${activePodId}` : null}
      onSelect={(id) => onSelect(Number(id.replace('pod-', '')))}
      height={height}
    />
  )
}
