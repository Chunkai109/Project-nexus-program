import { useState } from 'react'
import { JOINT_PRESETS, jointPresetForPair } from '@/lib/joints'
import type { NewExercise } from '@/lib/data/AppDataContext'
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
  /** The joint currently being defined, before it's confirmed into angleConfigs. */
  draftJointId: string | null
  draftMin: number
  draftMax: number
  draftFaultThresholdDeg: number
  /** The muscle currently being defined, before it's confirmed into muscleEmgTargets. */
  draftMuscleId: PodId | null
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
    draftJointId: null,
    draftMin: 90,
    draftMax: 110,
    draftFaultThresholdDeg: 8,
    draftMuscleId: null,
    draftMuscleEmgPct: 65,
  }
}

function formFromExercise(ex: Exercise): ExerciseFormState {
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
    draftJointId: null,
    draftMin: 90,
    draftMax: 110,
    draftFaultThresholdDeg: 8,
    draftMuscleId: null,
    draftMuscleEmgPct: 65,
  }
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
      draftMin: preset.defaultTargetMin,
      draftMax: preset.defaultTargetMax,
      draftFaultThresholdDeg: 8,
    }))
  }

  const draftValid = form.draftJointId != null
  const canSave = form.title.trim().length > 0 && form.angleConfigs.length > 0

  function confirmAngle() {
    setForm((f) => {
      const preset = JOINT_PRESETS.find((p) => p.id === f.draftJointId)
      if (!preset) return f
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
      return { ...f, angleConfigs, draftJointId: null, draftMin: 90, draftMax: 110, draftFaultThresholdDeg: 8 }
    })
  }

  function removeAngleConfig(id: string) {
    setForm((f) => ({ ...f, angleConfigs: f.angleConfigs.filter((c) => c.id !== id) }))
  }

  function loadAngleIntoDraft(c: AngleConfig) {
    const preset = jointPresetForPair(c.nodeA, c.nodeB)
    setForm((f) => ({
      ...f,
      draftJointId: preset?.id ?? null,
      draftMin: c.targetMin,
      draftMax: c.targetMax,
      draftFaultThresholdDeg: c.faultThresholdDeg,
    }))
  }

  function selectDraftMuscle(podId: PodId) {
    setForm((f) => {
      const existing = f.muscleEmgTargets.find((t) => t.podId === podId)
      return { ...f, draftMuscleId: podId, draftMuscleEmgPct: existing?.targetMvc ?? 65 }
    })
  }

  function setDraftMuscleEmgPct(pct: number) {
    setForm((f) => ({ ...f, draftMuscleEmgPct: pct }))
  }

  /** Setting a target for a muscle that already has one replaces it — never a second entry for the same muscle. */
  function confirmMuscleEmgTarget() {
    setForm((f) => {
      if (f.draftMuscleId == null) return f
      const newTarget: MuscleEmgTarget = { podId: f.draftMuscleId, targetMvc: f.draftMuscleEmgPct }
      const existingIndex = f.muscleEmgTargets.findIndex((t) => t.podId === f.draftMuscleId)
      const muscleEmgTargets =
        existingIndex >= 0
          ? f.muscleEmgTargets.map((t, i) => (i === existingIndex ? newTarget : t))
          : [...f.muscleEmgTargets, newTarget]
      return { ...f, muscleEmgTargets, draftMuscleId: null, draftMuscleEmgPct: 65 }
    })
  }

  function removeMuscleEmgTarget(podId: PodId) {
    setForm((f) => ({ ...f, muscleEmgTargets: f.muscleEmgTargets.filter((t) => t.podId !== podId) }))
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
    }
  }

  return {
    form,
    setForm,
    resetForm,
    toggleTag,
    selectDraftJoint,
    draftValid,
    canSave,
    confirmAngle,
    removeAngleConfig,
    loadAngleIntoDraft,
    selectDraftMuscle,
    setDraftMuscleEmgPct,
    confirmMuscleEmgTarget,
    removeMuscleEmgTarget,
    buildPayload,
  }
}
