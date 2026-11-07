import type { Exercise, MuscleEmgTarget } from '@/types'

/** One row of the patient-plan vs preset comparison table. */
export interface CompareRow {
  key: string
  label: string
  plan: string
  /** "—" when there's no preset to compare with. */
  preset: string
  /** True when a preset exists and this setting differs from it. */
  differs: boolean
  /** Saved with the plan but not yet used by live sessions. */
  notUsedYet?: boolean
}

function clip(text: string): string {
  const t = text.trim()
  if (!t) return '—'
  return t.length > 40 ? `${t.slice(0, 40)}…` : t
}

function emgKey(targets: MuscleEmgTarget[]): string {
  return JSON.stringify([...targets].sort((a, b) => a.muscleId.localeCompare(b.muscleId)).map((t) => [t.muscleId, t.targetMvc]))
}

interface Field {
  key: string
  label: string
  /** What's compared (raw, not the display text, so e.g. long notes compare in full). */
  value: (e: Exercise) => string | number
  display: (e: Exercise) => string
  notUsedYet?: boolean
}

const FIELDS: Field[] = [
  { key: 'setsReps', label: 'Sets × reps', value: (e) => `${e.sets}x${e.reps}`, display: (e) => `${e.sets} × ${e.reps}` },
  {
    key: 'rom',
    label: 'Range of motion',
    value: (e) => (e.angleConfigs[0] ? `${e.angleConfigs[0].targetMin}-${e.angleConfigs[0].targetMax}` : ''),
    display: (e) => (e.angleConfigs[0] ? `${e.angleConfigs[0].targetMin}–${e.angleConfigs[0].targetMax}°` : '—'),
  },
  { key: 'drift', label: 'Upper-arm drift limit', value: (e) => e.driftToleranceDeg, display: (e) => `${e.driftToleranceDeg}°` },
  {
    key: 'fault',
    label: 'Angle fault threshold',
    value: (e) => e.angleConfigs[0]?.faultThresholdDeg ?? '',
    display: (e) => (e.angleConfigs[0] ? `±${e.angleConfigs[0].faultThresholdDeg}°` : '—'),
    notUsedYet: true,
  },
  {
    key: 'emg',
    label: 'Muscle targets',
    value: (e) => emgKey(e.muscleEmgTargets),
    display: (e) => (e.muscleEmgTargets.length === 0 ? 'None set' : `${e.muscleEmgTargets.length} set`),
    notUsedYet: true,
  },
  { key: 'minutes', label: 'Est. minutes', value: (e) => e.estMinutes, display: (e) => `${e.estMinutes} min` },
  { key: 'note', label: 'Note to patient', value: (e) => e.therapistNote.trim(), display: (e) => clip(e.therapistNote) },
  { key: 'setup', label: 'Setup instructions', value: (e) => e.setupInstructions.trim(), display: (e) => clip(e.setupInstructions) },
]

export function compareRows(plan: Exercise, preset: Exercise | null): CompareRow[] {
  return FIELDS.map((f) => ({
    key: f.key,
    label: f.label,
    plan: f.display(plan),
    preset: preset ? f.display(preset) : '—',
    differs: preset !== null && f.value(plan) !== f.value(preset),
    notUsedYet: f.notUsedYet,
  }))
}

/** Number of the 8 compared settings that differ from the preset (0 without a preset). */
export function countChanges(plan: Exercise, preset: Exercise | null): number {
  return compareRows(plan, preset).filter((r) => r.differs).length
}

export function changesLabel(n: number): string {
  return `${n} change${n === 1 ? '' : 's'}`
}

/** Number of different patients with a plan copied from this preset. */
export function presetUsage(presetId: string, exercises: Exercise[]): number {
  return new Set(exercises.filter((e) => e.basedOnPresetId === presetId && e.assignedPatientId).map((e) => e.assignedPatientId)).size
}
