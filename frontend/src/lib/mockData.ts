import type {
  Exercise,
  PatientRosterEntry,
  Pod,
  Practice,
  SymmetryPoint,
  TelemetryPoint,
} from '@/types'

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

export const EXERCISES: Exercise[] = [
  {
    id: 'bilateral-squat',
    title: 'Bilateral Squat Rehab',
    muscleGroups: ['Quadriceps', 'Glutes', 'Hamstrings'],
    sets: 3,
    reps: 12,
    targetRomMin: 90,
    targetRomMax: 110,
    faultThresholdDeg: 8,
    targetEmgMvc: 65,
    therapistNote: 'Focus on symmetric weight distribution. Avoid knee valgus at depth.',
    setupInstructions: 'Attach Pods 1–2 to vastus medialis, Pods 3–4 to lateral knee joint line.',
    estMinutes: 12,
  },
  {
    id: 'knee-extension',
    title: 'Knee Extension Protocol',
    muscleGroups: ['Quadriceps'],
    sets: 4,
    reps: 10,
    targetRomMin: 45,
    targetRomMax: 100,
    faultThresholdDeg: 6,
    targetEmgMvc: 70,
    therapistNote: 'Controlled tempo — 2s concentric, 3s eccentric. Stop if sharp pain occurs.',
    setupInstructions: 'Attach Pod 2 to right vastus medialis, Pod 4 to right knee joint.',
    estMinutes: 10,
  },
  {
    id: 'single-leg-balance',
    title: 'Single-Leg Balance',
    muscleGroups: ['Stabilizers', 'Ankle Complex'],
    sets: 3,
    reps: 30,
    targetRomMin: 0,
    targetRomMax: 15,
    faultThresholdDeg: 10,
    targetEmgMvc: 40,
    therapistNote: 'Hold each rep for 30s. Progress to eyes-closed variant once stable.',
    setupInstructions: 'Attach Pods 5–6 to shin/ankle for sway and inversion tracking.',
    estMinutes: 9,
  },
]

export const PATIENT_ROSTER: PatientRosterEntry[] = [
  { id: 'alex-tan', name: 'Alex Tan', condition: 'ACL Reconstruction', lastSession: '2h ago', adherence: 92, avatarColor: '#38bdf8' },
  { id: 'mei-lin', name: 'Mei Lin Wong', condition: 'Meniscus Repair', lastSession: 'Yesterday', adherence: 78, avatarColor: '#10b981' },
  { id: 'raj-kumar', name: 'Raj Kumar', condition: 'Patellar Tendinopathy', lastSession: '3 days ago', adherence: 65, avatarColor: '#f59e0b' },
  { id: 'siti-aminah', name: 'Siti Aminah', condition: 'Post-Op Knee Replacement', lastSession: 'Today', adherence: 97, avatarColor: '#818cf8' },
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
