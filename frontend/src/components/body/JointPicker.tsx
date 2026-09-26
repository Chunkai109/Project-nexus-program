import { Body3DPicker, scaleMarkers, type BodyMarker } from './Body3DPicker'
import { useTheme } from '@/lib/ThemeContext'

/**
 * One marker per `JOINT_PRESETS` entry, positioned at that joint's actual
 * location on the mesh — measured the same way as the muscle picker's
 * markers (true outward surface point at the joint's height, nudged out a
 * small fixed margin so it hugs the limb without being occluded by it).
 */
const RAW_MARKERS: BodyMarker[] = [
  { id: 'left-shoulder', value: 'left-shoulder', position: [-2.74, 17.0, -0.29] },
  { id: 'right-shoulder', value: 'right-shoulder', position: [2.74, 17.0, -0.29] },
  { id: 'left-elbow', value: 'left-elbow', position: [-4.92, 13.2, -0.74] },
  { id: 'right-elbow', value: 'right-elbow', position: [4.92, 13.2, -0.74] },
  { id: 'left-hip', value: 'left-hip', position: [-2.12, 10.6, 0.17] },
  { id: 'right-hip', value: 'right-hip', position: [2.12, 10.6, 0.17] },
  { id: 'left-knee', value: 'left-knee', position: [-2.5, 5.9, -0.64] },
  { id: 'right-knee', value: 'right-knee', position: [2.5, 5.9, -0.64] },
]

const MARKERS = scaleMarkers(RAW_MARKERS)

/**
 * One tap picks a whole joint (both underlying sensor nodes at once), rather
 * than requiring two separate taps on raw sensor dots. The confirmed angle
 * this produces is exactly the same nodeA/nodeB pair shape as before. Uses
 * the same rotatable 3D scan as the EMG step's muscle picker so a physio
 * only has to learn one figure. Every joint starts red; one turns green as
 * soon as its angle is confirmed, so at a glance you can see what's left.
 */
export function JointPicker({
  selectedJointId,
  onSelect,
  confirmedJointIds,
  height = 220,
}: {
  selectedJointId: string | null
  onSelect: (jointId: string) => void
  confirmedJointIds?: Set<string>
  height?: number
}) {
  const { theme } = useTheme()
  const unconfirmedColor = theme === 'dark' ? '#ff453a' : '#d70015'

  return (
    <Body3DPicker
      markers={MARKERS}
      selectedValue={selectedJointId}
      confirmedValues={confirmedJointIds}
      onSelect={onSelect}
      height={height}
      unconfirmedColor={unconfirmedColor}
    />
  )
}
