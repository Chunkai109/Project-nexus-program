import { Body3DPicker, scaleMarkers, type BodyMarker } from './Body3DPicker'

/**
 * Marker positions were measured directly off the mesh's own vertices (the
 * true surface point furthest outward in each region) and nudged out by a
 * small, fixed margin so they hug the body instead of floating, while still
 * clearing the surface enough that the opaque mesh never blocks the
 * raycast; bilateral regions get two markers that both select the same
 * group.
 */
const RAW_MARKERS: BodyMarker[] = [
  { id: 'chest', value: 'chest', position: [0, 15.3, 1.33] },
  { id: 'back', value: 'back', position: [0, 15.3, -2.0] },
  { id: 'core', value: 'core', position: [0, 12.5, 1.29] },
  { id: 'left-shoulder', value: 'shoulder', position: [-2.74, 17.0, -0.29] },
  { id: 'right-shoulder', value: 'shoulder', position: [2.74, 17.0, -0.29] },
  { id: 'left-arm', value: 'arm', position: [-4.11, 14.8, -0.94] },
  { id: 'right-arm', value: 'arm', position: [4.11, 14.8, -0.94] },
  { id: 'left-forearm', value: 'forearm', position: [-5.56, 11.8, -0.55] },
  { id: 'right-forearm', value: 'forearm', position: [5.56, 11.8, -0.55] },
  { id: 'left-upper-leg', value: 'upper-leg', position: [-2.47, 8.0, -0.27] },
  { id: 'right-upper-leg', value: 'upper-leg', position: [2.47, 8.0, -0.27] },
  { id: 'left-lower-leg', value: 'lower-leg', position: [-2.48, 3.3, -0.77] },
  { id: 'right-lower-leg', value: 'lower-leg', position: [2.48, 3.3, -0.77] },
]

const MARKERS = scaleMarkers(RAW_MARKERS)

/**
 * One tap on a marker reveals which muscle group it is (bilateral regions
 * like Shoulder or Arm have two markers that both select the same group);
 * the specific muscle within that group is then picked from a dropdown, not
 * from the figure itself. Chest and Back sit on opposite sides of the torso,
 * so rotating the figure is what reveals Back — the reason this is a 3D
 * rotatable figure rather than a flat stickman.
 */
export function MuscleGroupPicker({
  selectedGroupId,
  onSelect,
  height = 260,
}: {
  selectedGroupId: string | null
  onSelect: (groupId: string) => void
  height?: number
}) {
  return <Body3DPicker markers={MARKERS} selectedValue={selectedGroupId} onSelect={onSelect} height={height} />
}
