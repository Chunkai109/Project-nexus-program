import type { AngleConfig, Exercise, PatientRecord, RepSample, SessionRecord } from '@/types'
import { normalizeMuscleEmgTargets, type LegacyMuscleEmgTarget } from '@/lib/muscles'

/** Defined here (not in AppDataContext, which imports this file) to avoid a circular import; re-exported from AppDataContext for existing callers. */
export type NewExercise = Omit<Exercise, 'id' | 'createdAt'>
export type NewSessionRecord = Omit<SessionRecord, 'id'>

/** Row shapes as they exist in Postgres (snake_case) — see supabase/schema.sql. */

export interface PatientRow {
  id: string
  name: string
  email: string
  first_seen_at: string
  last_seen_at: string
}

export interface ExerciseRow {
  id: string
  title: string
  muscle_groups: string[]
  sets: number
  reps: number
  muscle_emg_targets: LegacyMuscleEmgTarget[]
  therapist_note: string
  setup_instructions: string
  est_minutes: number
  angle_configs: AngleConfig[]
  assigned_patient_id: string | null
  created_at: string
}

export interface SessionRow {
  id: string
  patient_id: string
  patient_name: string
  exercise_id: string
  exercise_title: string
  completed_at: string
  duration_sec: number
  target_min: number
  target_max: number
  reps: RepSample[]
}

export function patientFromRow(row: PatientRow): PatientRecord {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    firstSeenAt: new Date(row.first_seen_at).getTime(),
    lastSeenAt: new Date(row.last_seen_at).getTime(),
  }
}

export function exerciseFromRow(row: ExerciseRow): Exercise {
  return {
    id: row.id,
    title: row.title,
    muscleGroups: row.muscle_groups,
    sets: row.sets,
    reps: row.reps,
    muscleEmgTargets: normalizeMuscleEmgTargets(row.muscle_emg_targets),
    therapistNote: row.therapist_note,
    setupInstructions: row.setup_instructions,
    estMinutes: row.est_minutes,
    angleConfigs: row.angle_configs,
    assignedPatientId: row.assigned_patient_id,
    createdAt: new Date(row.created_at).getTime(),
  }
}

export function sessionFromRow(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    patientId: row.patient_id,
    patientName: row.patient_name,
    exerciseId: row.exercise_id,
    exerciseTitle: row.exercise_title,
    completedAt: new Date(row.completed_at).getTime(),
    durationSec: row.duration_sec,
    targetMin: row.target_min,
    targetMax: row.target_max,
    reps: row.reps,
  }
}

/** Columns derived from a NewExercise patch, shared by insert and update payloads. */
export function exercisePatchToRow(patch: NewExercise) {
  return {
    title: patch.title,
    muscle_groups: patch.muscleGroups,
    sets: patch.sets,
    reps: patch.reps,
    muscle_emg_targets: patch.muscleEmgTargets,
    therapist_note: patch.therapistNote,
    setup_instructions: patch.setupInstructions,
    est_minutes: patch.estMinutes,
    angle_configs: patch.angleConfigs,
    assigned_patient_id: patch.assignedPatientId,
  }
}

export function exerciseToRow(exercise: Exercise) {
  return {
    id: exercise.id,
    created_at: new Date(exercise.createdAt).toISOString(),
    ...exercisePatchToRow(exercise),
  }
}

export function sessionToRow(session: SessionRecord) {
  return {
    id: session.id,
    patient_id: session.patientId,
    patient_name: session.patientName,
    exercise_id: session.exerciseId,
    exercise_title: session.exerciseTitle,
    completed_at: new Date(session.completedAt).toISOString(),
    duration_sec: session.durationSec,
    target_min: session.targetMin,
    target_max: session.targetMax,
    reps: session.reps,
  } satisfies SessionRow
}
