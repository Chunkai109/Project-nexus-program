import { useState } from 'react'
import { JOINT_PRESETS, jointPresetForPair } from '@/lib/joints'
import { DEFAULT_DRIFT_TOLERANCE_DEG, type NewExercise } from '@/lib/data/AppDataContext'
import type { AngleConfig, Exercise, MuscleEmgTarget, PodId } from '@/types'

export interface ExerciseFormState {
  title: string
  muscleGroups: string[]
  sets: number
  reps: number
  muscleEmgTargets: MuscleEmgTarget[]
  therapistNote: string
  setupInstructions: string
  estMinutes: number
  angleConfigs: AngleConfig[]
  assignedPatientId: string | null
  /** Kept as typed text so the field can show a validation message instead of silently coercing. */
  driftToleranceInput: string
  /** The joint currently being defined, before it's confirmed into angleConfigs. */
  draftJointId: string | null
  /** The confirmed angle loaded back for editing, so one with no matching joint (e.g. the curl rig's pods 2↔3) can still be re-confirmed. */
  draftConfigId: string | null
  draftMin: number
  draftMax: number
  draftFaultThresholdDeg: number
  /** The muscle group/muscle currently being defined, before it's confirmed into muscleEmgTargets. */
  draftMuscleGroupId: string | null
  draftMuscleId: string | null
  draftMuscleEmgPct: number
}

function blankForm(): ExerciseFormState {
  return {
    title: '',
    muscleGroups: [],
    sets: 3,
    reps: 12,
    muscleEmgTargets: [],
    therapistNote: '',
    setupInstructions: '',
    estMinutes: 10,
    angleConfigs: [],
    assignedPatientId: null,
    driftToleranceInput: String(DEFAULT_DRIFT_TOLERANCE_DEG),
    draftJointId: null,
    draftConfigId: null,
    draftMin: 90,
    draftMax: 110,
    draftFaultThresholdDeg: 8,
    draftMuscleGroupId: null,
    draftMuscleId: null,
    draftMuscleEmgPct: 65,
  }
}

export function formFromExercise(ex: Exercise): ExerciseFormState {
  return {
    title: ex.title,
    muscleGroups: ex.muscleGroups,
    sets: ex.sets,
    reps: ex.reps,
    muscleEmgTargets: ex.muscleEmgTargets,
    therapistNote: ex.therapistNote,
    setupInstructions: ex.setupInstructions,
    estMinutes: ex.estMinutes,
    angleConfigs: ex.angleConfigs,
    assignedPatientId: ex.assignedPatientId,
    driftToleranceInput: String(ex.driftToleranceDeg),
    draftJointId: null,
    draftConfigId: null,
    draftMin: 90,
    draftMax: 110,
    draftFaultThresholdDeg: 8,
    draftMuscleGroupId: null,
    draftMuscleId: null,
    draftMuscleEmgPct: 65,
  }
}

export const DRIFT_LIMIT_MIN = 1
export const DRIFT_LIMIT_MAX = 90
/** Below this, rig testing saw the drift fault fire on normal movement. */
export const DRIFT_LIMIT_WARN_BELOW = 20

/** The drift limit as a whole number of degrees, or null if the text isn't a whole number from 1 to 90. */
export function parseDriftLimit(input: string): number | null {
  const text = input.trim()
  if (!/^\d+$/.test(text)) return null
  const n = Number(text)
  return n >= DRIFT_LIMIT_MIN && n <= DRIFT_LIMIT_MAX ? n : null
}

/** Same two joints regardless of which node was tapped first. */
function sameNodePair(a: AngleConfig, nodeA: PodId, nodeB: PodId): boolean {
  return (a.nodeA === nodeA && a.nodeB === nodeB) || (a.nodeA === nodeB && a.nodeB === nodeA)
}

/**
 * All the state and mutation logic behind the exercise create/edit form,
 * shared by ProtocolBuilder's "New Exercise" flow and ExerciseFineTune's
 * edit flow so both render the identical field set from a single source of
 * truth.
 */
export function useExerciseForm(initial?: Exercise) {
  const [form, setForm] = useState<ExerciseFormState>(() => (initial ? formFromExercise(initial) : blankForm()))

  function resetForm(nextInitial?: Exercise) {
    setForm(nextInitial ? formFromExercise(nextInitial) : blankForm())
  }

  function toggleTag(tag: string) {
    setForm((f) => ({
      ...f,
      muscleGroups: f.muscleGroups.includes(tag) ? f.muscleGroups.filter((t) => t !== tag) : [...f.muscleGroups, tag],
    }))
  }

  /** Selecting a joint stands in for the old two-tap flow — both underlying sensor nodes come along with it. */
  function selectDraftJoint(jointId: string) {
    const preset = JOINT_PRESETS.find((p) => p.id === jointId)
    if (!preset) return
    setForm((f) => ({
      ...f,
      draftJointId: jointId,
      draftConfigId: null,
      draftMin: preset.defaultTargetMin,
      draftMax: preset.defaultTargetMax,
      draftFaultThresholdDeg: 8,
    }))
  }

  const draftValid = form.draftJointId != null || form.draftConfigId != null
  const driftLimit = parseDriftLimit(form.driftToleranceInput)
  const canSave = form.title.trim().length > 0 && form.angleConfigs.length > 0 && driftLimit !== null

  function confirmAngle() {
    setForm((f) => {
      const preset = JOINT_PRESETS.find((p) => p.id === f.draftJointId)
      const cleared = { draftJointId: null, draftConfigId: null, draftMin: 90, draftMax: 110, draftFaultThresholdDeg: 8 }
      if (!preset) {
        // A loaded angle with no matching joint: update it in place.
        if (f.draftConfigId == null) return f
        const angleConfigs = f.angleConfigs.map((c) =>
          c.id === f.draftConfigId
            ? { ...c, targetMin: f.draftMin, targetMax: f.draftMax, faultThresholdDeg: f.draftFaultThresholdDeg }
            : c,
        )
        return { ...f, angleConfigs, ...cleared }
      }
      const existingIndex = f.angleConfigs.findIndex((c) => sameNodePair(c, preset.nodeA, preset.nodeB))
      const newConfig: AngleConfig = {
        id: existingIndex >= 0 ? f.angleConfigs[existingIndex].id : crypto.randomUUID(),
        nodeA: preset.nodeA,
        nodeB: preset.nodeB,
        targetMin: f.draftMin,
        targetMax: f.draftMax,
        faultThresholdDeg: f.draftFaultThresholdDeg,
      }
      const angleConfigs =
        existingIndex >= 0
          ? f.angleConfigs.map((c, i) => (i === existingIndex ? newConfig : c))
          : [...f.angleConfigs, newConfig]
      return { ...f, angleConfigs, ...cleared }
    })
  }

  function removeAngleConfig(id: string) {
    setForm((f) => ({
      ...f,
      angleConfigs: f.angleConfigs.filter((c) => c.id !== id),
      draftConfigId: f.draftConfigId === id ? null : f.draftConfigId,
    }))
  }

  function loadAngleIntoDraft(c: AngleConfig) {
    const preset = jointPresetForPair(c.nodeA, c.nodeB)
    setForm((f) => ({
      ...f,
      draftJointId: preset?.id ?? null,
      draftConfigId: c.id,
      draftMin: c.targetMin,
      draftMax: c.targetMax,
      draftFaultThresholdDeg: c.faultThresholdDeg,
    }))
  }

  /** Picking a group clears any specific muscle from the previous group — the dropdown always reflects the group currently selected. */
  function selectDraftMuscleGroup(groupId: string) {
    setForm((f) => ({ ...f, draftMuscleGroupId: groupId, draftMuscleId: null, draftMuscleEmgPct: 65 }))
  }

  function selectDraftMuscle(muscleId: string) {
    setForm((f) => {
      const existing = f.muscleEmgTargets.find((t) => t.muscleId === muscleId)
      return { ...f, draftMuscleId: muscleId, draftMuscleEmgPct: existing?.targetMvc ?? 65 }
    })
  }

  function setDraftMuscleEmgPct(pct: number) {
    setForm((f) => ({ ...f, draftMuscleEmgPct: pct }))
  }

  /** Setting a target for a muscle that already has one replaces it — never a second entry for the same muscle. */
  function confirmMuscleEmgTarget() {
    setForm((f) => {
      if (f.draftMuscleId == null) return f
      const newTarget: MuscleEmgTarget = { muscleId: f.draftMuscleId, targetMvc: f.draftMuscleEmgPct }
      const existingIndex = f.muscleEmgTargets.findIndex((t) => t.muscleId === f.draftMuscleId)
      const muscleEmgTargets =
        existingIndex >= 0
          ? f.muscleEmgTargets.map((t, i) => (i === existingIndex ? newTarget : t))
          : [...f.muscleEmgTargets, newTarget]
      return { ...f, muscleEmgTargets, draftMuscleGroupId: null, draftMuscleId: null, draftMuscleEmgPct: 65 }
    })
  }

  function removeMuscleEmgTarget(muscleId: string) {
    setForm((f) => ({ ...f, muscleEmgTargets: f.muscleEmgTargets.filter((t) => t.muscleId !== muscleId) }))
  }

  function buildPayload(): NewExercise {
    return {
      title: form.title.trim(),
      muscleGroups: form.muscleGroups,
      sets: form.sets,
      reps: form.reps,
      muscleEmgTargets: form.muscleEmgTargets,
      therapistNote: form.therapistNote,
      setupInstructions: form.setupInstructions,
      estMinutes: form.estMinutes,
      angleConfigs: form.angleConfigs,
      assignedPatientId: form.assignedPatientId,
      driftToleranceDeg: driftLimit ?? DEFAULT_DRIFT_TOLERANCE_DEG,
    }
  }

  return {
    form,
    setForm,
    resetForm,
    driftLimit,
    toggleTag,
    selectDraftJoint,
    draftValid,
    canSave,
    confirmAngle,
    removeAngleConfig,
    loadAngleIntoDraft,
    selectDraftMuscleGroup,
    selectDraftMuscle,
    setDraftMuscleEmgPct,
    confirmMuscleEmgTarget,
    removeMuscleEmgTarget,
    buildPayload,
  }
}
