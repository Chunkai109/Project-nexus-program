import type { AngleConfig, Exercise, PatientRecord, RepSample, SessionRecord } from '@/types'
import { normalizeMuscleEmgTargets, type LegacyMuscleEmgTarget } from '@/lib/muscles'
import { isBodyRegion, suggestBodyRegion } from '@/lib/bodyRegion'

/** Defined here (not in AppDataContext, which imports this file) to avoid a circular import; re-exported from AppDataContext for existing callers. */
/** The editable fields of an exercise. Ids, timestamps and preset links are set by AppDataContext. */
export type NewExercise = Omit<Exercise, 'id' | 'createdAt' | 'updatedAt' | 'basedOnPresetId' | 'presetSnapshotAt'>
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
  based_on_preset_id: string | null
  drift_tolerance_deg: number | null
  body_region?: string | null
  created_at: string
  updated_at: string | null
  preset_snapshot_at: string | null
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
    basedOnPresetId: row.based_on_preset_id ?? null,
    driftToleranceDeg: row.drift_tolerance_deg ?? 22,
    // Missing until the migration in supabase/schema.sql has been run: fall back to the suggestion.
    bodyRegion: isBodyRegion(row.body_region) ? row.body_region : suggestBodyRegion(row.muscle_groups),
    createdAt: new Date(row.created_at).getTime(),
    // Columns may be missing until the migration in supabase/schema.sql has been run.
    updatedAt: new Date(row.updated_at ?? row.created_at).getTime(),
    presetSnapshotAt: row.preset_snapshot_at ? new Date(row.preset_snapshot_at).getTime() : null,
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
export function exercisePatchToRow(patch: NewExercise, updatedAt: number) {
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
    drift_tolerance_deg: patch.driftToleranceDeg,
    body_region: patch.bodyRegion,
    updated_at: new Date(updatedAt).toISOString(),
  }
}

export function exerciseToRow(exercise: Exercise) {
  return {
    id: exercise.id,
    created_at: new Date(exercise.createdAt).toISOString(),
    based_on_preset_id: exercise.basedOnPresetId,
    preset_snapshot_at: exercise.presetSnapshotAt === null ? null : new Date(exercise.presetSnapshotAt).toISOString(),
    ...exercisePatchToRow(exercise, exercise.updatedAt),
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
