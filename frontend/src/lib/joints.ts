import type { PodId } from '@/types'

/**
 * Labels for sensor nodes beyond the 6-pod hardware kit (shoulder/elbow/hip
 * points). These exist only for the Exercise Creator's angle/EMG pickers —
 * they're not part of the physical SmartPhysio hub shown in Sensor Setup or
 * Calibration, which still ship with exactly the 6 pods in `PODS`.
 */
const VIRTUAL_NODE_LABELS: Partial<Record<PodId, string>> = {
  7: 'Left Deltoid',
  8: 'Right Deltoid',
  9: 'Left Elbow Joint',
  10: 'Right Elbow Joint',
  11: 'Left Wrist',
  12: 'Right Wrist',
  13: 'Left Hip Joint',
  14: 'Right Hip Joint',
}

export function virtualNodeLabel(id: PodId): string | undefined {
  return VIRTUAL_NODE_LABELS[id]
}

/** SVG (viewBox 0 0 200 400) positions for every node the joint/muscle pickers can show, shared so both line up on the same silhouette. */
export const NODE_POSITIONS: Partial<Record<PodId, { x: number; y: number }>> = {
  1: { x: 72, y: 205 }, // Left Vastus Medialis
  2: { x: 128, y: 205 }, // Right Vastus Medialis
  3: { x: 80, y: 268 }, // Left Knee Joint
  4: { x: 120, y: 268 }, // Right Knee Joint
  7: { x: 62, y: 78 }, // Left Deltoid
  8: { x: 138, y: 78 }, // Right Deltoid
  9: { x: 38, y: 100 }, // Left Elbow Joint
  10: { x: 162, y: 100 }, // Right Elbow Joint
  13: { x: 76, y: 168 }, // Left Hip Joint
  14: { x: 124, y: 168 }, // Right Hip Joint
}

export interface JointPreset {
  id: string
  label: string
  side: 'left' | 'right'
  /** The two sensor nodes an angle for this joint is measured between — unchanged from how a confirmed angle has always worked. */
  nodeA: PodId
  nodeB: PodId
  /** Which of the two nodes this joint's marker is drawn at on the picker. */
  markerNodeId: PodId
  defaultTargetMin: number
  defaultTargetMax: number
}

/** One common joint per side. Selecting one of these is now the entire interaction for defining an angle — the physio no longer has to know which two raw sensor nodes it's built from. */
export const JOINT_PRESETS: JointPreset[] = [
  { id: 'left-shoulder', label: 'Left Shoulder', side: 'left', nodeA: 7, nodeB: 9, markerNodeId: 7, defaultTargetMin: 30, defaultTargetMax: 150 },
  { id: 'right-shoulder', label: 'Right Shoulder', side: 'right', nodeA: 8, nodeB: 10, markerNodeId: 8, defaultTargetMin: 30, defaultTargetMax: 150 },
  { id: 'left-elbow', label: 'Left Elbow', side: 'left', nodeA: 9, nodeB: 11, markerNodeId: 9, defaultTargetMin: 20, defaultTargetMax: 145 },
  { id: 'right-elbow', label: 'Right Elbow', side: 'right', nodeA: 10, nodeB: 12, markerNodeId: 10, defaultTargetMin: 20, defaultTargetMax: 145 },
  { id: 'left-hip', label: 'Left Hip', side: 'left', nodeA: 13, nodeB: 1, markerNodeId: 13, defaultTargetMin: 10, defaultTargetMax: 120 },
  { id: 'right-hip', label: 'Right Hip', side: 'right', nodeA: 14, nodeB: 2, markerNodeId: 14, defaultTargetMin: 10, defaultTargetMax: 120 },
  { id: 'left-knee', label: 'Left Knee', side: 'left', nodeA: 1, nodeB: 3, markerNodeId: 3, defaultTargetMin: 90, defaultTargetMax: 110 },
  { id: 'right-knee', label: 'Right Knee', side: 'right', nodeA: 2, nodeB: 4, markerNodeId: 4, defaultTargetMin: 90, defaultTargetMax: 110 },
]

/** Reverse lookup so editing an existing confirmed angle can re-select the joint it came from. */
export function jointPresetForPair(nodeA: PodId, nodeB: PodId): JointPreset | undefined {
  return JOINT_PRESETS.find((p) => (p.nodeA === nodeA && p.nodeB === nodeB) || (p.nodeA === nodeB && p.nodeB === nodeA))
}
