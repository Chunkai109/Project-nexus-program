import type { Pod, Practice } from '@/types'

export const PRACTICES: Practice[] = [
  { id: 'apex', name: 'Apex Sports Rehabilitation' },
  { id: 'summit', name: 'Summit Orthopaedic Clinic' },
  { id: 'meridian', name: 'Meridian Physiotherapy Group' },
]

export const PODS: Pod[] = [
  { id: 1, label: 'Pod 1', location: 'Left Vastus Medialis', kind: 'EMG+IMU', signal: 'strong', battery: 94 },
  { id: 2, label: 'Pod 2', location: 'Right Vastus Medialis', kind: 'EMG+IMU', signal: 'strong', battery: 91 },
  { id: 3, label: 'Pod 3', location: 'Left Knee Joint', kind: 'IMU+Haptics', signal: 'strong', battery: 88 },
  { id: 4, label: 'Pod 4', location: 'Right Knee Joint', kind: 'IMU+Haptics', signal: 'weak', battery: 76 },
  { id: 5, label: 'Pod 5', location: 'Left Shin / Ankle', kind: 'IMU', signal: 'strong', battery: 97 },
  { id: 6, label: 'Pod 6', location: 'Right Shin / Ankle', kind: 'IMU', signal: 'strong', battery: 95 },
]
