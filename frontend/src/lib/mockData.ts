import type { Pod, Practice, SymmetryPoint, TelemetryPoint } from '@/types'

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

function buildTelemetryHistory(): TelemetryPoint[] {
  const points: TelemetryPoint[] = []
  for (let t = 0; t < 40; t++) {
    const base = 100 + Math.sin(t / 3) * 14
    const noise = (Math.sin(t * 1.7) + Math.sin(t * 0.6)) * 3
    points.push({
      t,
      angle: Math.round(base + noise),
      targetMin: 90,
      targetMax: 110,
    })
  }
  return points
}

export const TELEMETRY_HISTORY: TelemetryPoint[] = buildTelemetryHistory()

export const SYMMETRY_HISTORY: SymmetryPoint[] = [
  { session: 'S1', left: 58, right: 71 },
  { session: 'S2', left: 62, right: 74 },
  { session: 'S3', left: 65, right: 73 },
  { session: 'S4', left: 69, right: 75 },
  { session: 'S5', left: 74, right: 77 },
  { session: 'S6', left: 78, right: 78 },
]
