import { useState } from 'react'
import { podSide } from '@/lib/podUtils'
import type { NewExercise } from '@/lib/data/AppDataContext'
import type { AngleConfig, Exercise, PodId } from '@/types'

export interface ExerciseFormState {
  title: string
  muscleGroups: string[]
  sets: number
  reps: number
  targetEmgMvc: number
  therapistNote: string
  setupInstructions: string
  estMinutes: number
  angleConfigs: AngleConfig[]
  assignedPatientId: string | null
  /** The angle currently being defined, before it's confirmed into angleConfigs. */
  draftNodes: PodId[]
  draftMin: number
  draftMax: number
  draftFaultThresholdDeg: number
}

function blankForm(): ExerciseFormState {
  return {
    title: '',
    muscleGroups: [],
    sets: 3,
    reps: 12,
    targetEmgMvc: 65,
    therapistNote: '',
    setupInstructions: '',
    estMinutes: 10,
    angleConfigs: [],
    assignedPatientId: null,
    draftNodes: [],
    draftMin: 90,
    draftMax: 110,
    draftFaultThresholdDeg: 8,
  }
}

function formFromExercise(ex: Exercise): ExerciseFormState {
  return {
    title: ex.title,
    muscleGroups: ex.muscleGroups,
    sets: ex.sets,
    reps: ex.reps,
    targetEmgMvc: ex.targetEmgMvc,
    therapistNote: ex.therapistNote,
    setupInstructions: ex.setupInstructions,
    estMinutes: ex.estMinutes,
    angleConfigs: ex.angleConfigs,
    assignedPatientId: ex.assignedPatientId,
    draftNodes: [],
    draftMin: 90,
    draftMax: 110,
    draftFaultThresholdDeg: 8,
  }
}

/** Same two joints regardless of which node was tapped first. */
function sameNodePair(a: AngleConfig, nodeA: PodId, nodeB: PodId): boolean {
  return (a.nodeA === nodeA && a.nodeB === nodeB) || (a.nodeA === nodeB && a.nodeB === nodeA)
}

/**
 * All the state and mutation logic behind the exercise create/edit form,
 * shared by ProtocolBuilder's "New Exercise" flow and ExerciseDetail's
 * "fine-tune this exercise" flow so both render the identical field set
 * from a single source of truth.
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

  function toggleDraftNode(id: PodId) {
    setForm((f) => {
      if (f.draftNodes.includes(id)) return { ...f, draftNodes: f.draftNodes.filter((n) => n !== id) }
      if (f.draftNodes.length < 2) return { ...f, draftNodes: [...f.draftNodes, id] }
      return { ...f, draftNodes: [id] }
    })
  }

  const draftValid = form.draftNodes.length === 2 && podSide(form.draftNodes[0]) === podSide(form.draftNodes[1])
  const draftSideMismatch = form.draftNodes.length === 2 && !draftValid
  const canSave = form.title.trim().length > 0 && form.angleConfigs.length > 0

  function confirmAngle() {
    setForm((f) => {
      if (f.draftNodes.length !== 2 || podSide(f.draftNodes[0]) !== podSide(f.draftNodes[1])) return f
      const [nodeA, nodeB] = f.draftNodes
      const existingIndex = f.angleConfigs.findIndex((c) => sameNodePair(c, nodeA, nodeB))
      const newConfig: AngleConfig = {
        id: existingIndex >= 0 ? f.angleConfigs[existingIndex].id : crypto.randomUUID(),
        nodeA,
        nodeB,
        targetMin: f.draftMin,
        targetMax: f.draftMax,
        faultThresholdDeg: f.draftFaultThresholdDeg,
      }
      const angleConfigs =
        existingIndex >= 0
          ? f.angleConfigs.map((c, i) => (i === existingIndex ? newConfig : c))
          : [...f.angleConfigs, newConfig]
      return { ...f, angleConfigs, draftNodes: [], draftMin: 90, draftMax: 110, draftFaultThresholdDeg: 8 }
    })
  }

  function removeAngleConfig(id: string) {
    setForm((f) => ({ ...f, angleConfigs: f.angleConfigs.filter((c) => c.id !== id) }))
  }

  function loadAngleIntoDraft(c: AngleConfig) {
    setForm((f) => ({
      ...f,
      draftNodes: [c.nodeA, c.nodeB],
      draftMin: c.targetMin,
      draftMax: c.targetMax,
      draftFaultThresholdDeg: c.faultThresholdDeg,
    }))
  }

  function buildPayload(): NewExercise {
    return {
      title: form.title.trim(),
      muscleGroups: form.muscleGroups,
      sets: form.sets,
      reps: form.reps,
      targetEmgMvc: form.targetEmgMvc,
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
    toggleDraftNode,
    draftValid,
    draftSideMismatch,
    canSave,
    confirmAngle,
    removeAngleConfig,
    loadAngleIntoDraft,
    buildPayload,
  }
}
