export type UserRole = 'patient' | 'physio'

export interface Practice {
  id: string
  name: string
}

export interface AuthUser {
  role: UserRole
  name: string
  email: string
  practiceId: string
}

export type PodSignal = 'strong' | 'weak' | 'offline'
export type PodKind = 'EMG+IMU' | 'IMU+Haptics' | 'IMU'

export interface Pod {
  id: number
  label: string
  location: string
  kind: PodKind
  signal: PodSignal
  battery: number
}

export interface Exercise {
  id: string
  title: string
  muscleGroups: string[]
  sets: number
  reps: number
  targetRomMin: number
  targetRomMax: number
  faultThresholdDeg: number
  targetEmgMvc: number
  therapistNote: string
  setupInstructions: string
  estMinutes: number
}

export interface SessionMetrics {
  kneeFlexionDeg: number
  targetMin: number
  targetMax: number
  emgLeft: number
  emgRight: number
  faultActive: boolean
  faultLabel: string | null
  faultDeg: number
  activeHapticPod: number | null
  repCount: number
  elapsedSec: number
}

export interface TelemetryPoint {
  t: number
  angle: number
  targetMin: number
  targetMax: number
}

export interface SymmetryPoint {
  session: string
  left: number
  right: number
}

export interface PatientRosterEntry {
  id: string
  name: string
  condition: string
  lastSession: string
  adherence: number
  avatarColor: string
}
