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
export type PodId = 1 | 2 | 3 | 4 | 5 | 6

export interface Pod {
  id: PodId
  label: string
  location: string
  kind: PodKind
  signal: PodSignal
  battery: number
}

/** One physio-confirmed joint angle target: two sensor nodes and the ROM range measured between them. */
export interface AngleConfig {
  id: string
  nodeA: PodId
  nodeB: PodId
  targetMin: number
  targetMax: number
}

export interface Exercise {
  id: string
  title: string
  muscleGroups: string[]
  sets: number
  reps: number
  faultThresholdDeg: number
  targetEmgMvc: number
  therapistNote: string
  setupInstructions: string
  estMinutes: number
  /** Every angle confirmed for this exercise; the first is the primary pair a live session tracks. */
  angleConfigs: AngleConfig[]
  /** Patient this exercise is assigned to, or null to assign it to every patient. */
  assignedPatientId: string | null
  createdAt: number
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

/** A real patient, recorded the first time they sign in — not a fake profile. */
export interface PatientRecord {
  id: string
  name: string
  email: string
  firstSeenAt: number
  lastSeenAt: number
}

/** One completed rep, sampled the instant the rep counter ticks over during a live session. */
export interface RepSample {
  rep: number
  angle: number
  emgLeft: number
  emgRight: number
  faultActive: boolean
}

/** A real completed session, recorded when a patient hits "End Session & Sync Data". */
export interface SessionRecord {
  id: string
  patientId: string
  patientName: string
  exerciseId: string
  exerciseTitle: string
  completedAt: number
  durationSec: number
  targetMin: number
  targetMax: number
  reps: RepSample[]
}
