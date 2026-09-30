import { Body3DPicker, scaleMarkers, type BodyMarker } from './Body3DPicker'
import type { Pod } from '@/types'

/**
 * Marker positions for the real bicep-curl rig, anchored to the same right
 * arm already measured on this mesh elsewhere (right-shoulder [2.74, 17.0,
 * -0.29], right-arm/bicep [4.11, 14.8, -0.94], right-elbow [4.92, 13.2,
 * -0.74] and right-forearm [5.56, 11.8, -0.55] in JointPicker.tsx /
 * MuscleGroupPicker.tsx) rather than measured fresh, so they land on
 * verified surface points instead of guessed ones:
 *  - Pod 1 sits exactly at the bicep muscle marker — this is where the
 *    EMG red/green electrode pair goes (2cm apart, see SensorSetup.tsx's
 *    placement steps for that detail; a single pod marker can't show two
 *    2cm-apart points at this scale).
 *  - Pod 3 interpolates 75% of the way from the bicep marker to the elbow,
 *    landing just above the joint on the lower tricep.
 *  - Pod 2 sits exactly at the forearm muscle marker (outer mid-forearm,
 *    between flexor and extensor).
 *  - Motor 15 (corridor) sits between the shoulder and bicep markers;
 *    Motor 16 (fault) extrapolates past the forearm marker toward the
 *    wrist — both just "somewhere on the bicep/forearm part" per spec,
 *    offset from the pods above so all 5 markers stay visually distinct.
 */
const RAW_MARKERS: BodyMarker[] = [
  { id: 'pod-1', value: '1', position: [4.11, 14.8, -0.94] },
  { id: 'pod-15', value: '15', position: [3.5, 15.67, -0.45] },
  { id: 'pod-3', value: '3', position: [4.72, 13.6, -0.79] },
  { id: 'pod-2', value: '2', position: [5.56, 11.8, -0.55] },
  { id: 'pod-16', value: '16', position: [5.88, 11.1, -0.46] },
]

const MARKERS = scaleMarkers(RAW_MARKERS)

/**
 * A rotatable 3D placement guide for the real 3-pod + 2-motor bicep rig —
 * lets a patient spin the arm around to see exactly where each pod and
 * motor goes before strapping anything on, instead of inferring 3D
 * placement from a flat stick figure. Reuses the same scanned-mesh model
 * and rotate interaction as the physio's joint/muscle pickers so patients
 * only ever learn one figure across the whole app. Markers whose pod is
 * currently reporting a strong signal render green, mirroring the flat
 * BodyMap's signal-strength coloring; tapping one calls onSelect so the
 * pod list below can stay in sync with whichever marker is highlighted.
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
  const strongSignalIds = new Set(pods.filter((p) => p.signal === 'strong').map((p) => String(p.id)))

  return (
    <Body3DPicker
      markers={MARKERS}
      selectedValue={activePodId !== null ? String(activePodId) : null}
      confirmedValues={strongSignalIds}
      onSelect={(value) => onSelect(Number(value))}
      height={height}
    />
  )
}
