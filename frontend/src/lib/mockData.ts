import type { Pod, Practice } from '@/types'

export const PRACTICES: Practice[] = [
  { id: 'apex', name: 'Apex Sports Rehabilitation' },
  { id: 'summit', name: 'Summit Orthopaedic Clinic' },
  { id: 'meridian', name: 'Meridian Physiotherapy Group' },
]

// The real bicep-curl rig: 3 sensor pods worn on one arm (1 EMG + 2 IMU) plus
// 1 vibration motor, addressed as its own pod id (15 — chosen to sit above
// the virtual joint/muscle node range in lib/joints.ts and muscles.ts, which
// top out at 14, so a haptic command can never collide with a real or
// virtual sensor node). Pod ids are a namespace shared across every exercise
// type (see lib/joints.ts's JOINT_PRESETS), so Squats/Push Up/Shoulder
// Press's joint-picker labels for ids 1-4 now show this bicep rig's wording
// too — cosmetic only, since those exercises were never backed by real
// hardware to begin with. Down from two motors (a separate fault-alert motor
// was removed): one motor, pulsing only on correct form, is the only haptic
// feedback this rig gives.
export const PODS: Pod[] = [
  { id: 1, label: 'Pod 1', location: 'Bicep (EMG)', kind: 'EMG', signal: 'strong', battery: 94 },
  { id: 2, label: 'Pod 2', location: 'Outer Forearm (IMU)', kind: 'IMU', signal: 'strong', battery: 91 },
  { id: 3, label: 'Pod 3', location: 'Lower Tricep, Near Elbow (IMU)', kind: 'IMU', signal: 'strong', battery: 88 },
  { id: 15, label: 'Motor 1', location: 'Correct Form Alert (bicep)', kind: 'Haptics', signal: 'strong', battery: 100 },
]
