import type { MuscleEmgTarget, PodId } from '@/types'

export interface MuscleOption {
  id: string
  label: string
}

export interface MuscleGroup {
  id: string
  label: string
  muscles: MuscleOption[]
}

/** Every muscle in a group gets a Left/Right variant, matching the Left/Right convention already used for joints. */
function sidedMuscles(names: string[]): MuscleOption[] {
  return names.flatMap((name) => {
    const slug = name.toLowerCase().replace(/\s+/g, '-')
    return [
      { id: `left-${slug}`, label: `Left ${name}` },
      { id: `right-${slug}`, label: `Right ${name}` },
    ]
  })
}

/** The major muscle groups a physio can set a target EMG activation for — independent of the 6-pod hardware kit, since this is a documented characteristic of the protocol rather than a live sensor reading. */
export const MUSCLE_GROUPS: MuscleGroup[] = [
  { id: 'chest', label: 'Chest', muscles: sidedMuscles(['Pectoralis Major', 'Pectoralis Minor']) },
  { id: 'back', label: 'Back', muscles: sidedMuscles(['Latissimus Dorsi', 'Trapezius', 'Rhomboids']) },
  { id: 'shoulder', label: 'Shoulder', muscles: sidedMuscles(['Anterior Deltoid', 'Lateral Deltoid', 'Posterior Deltoid']) },
  { id: 'arm', label: 'Arm', muscles: sidedMuscles(['Biceps Brachii', 'Triceps Brachii']) },
  { id: 'forearm', label: 'Forearm', muscles: sidedMuscles(['Flexor Carpi Radialis', 'Extensor Carpi Radialis']) },
  { id: 'core', label: 'Core', muscles: sidedMuscles(['Rectus Abdominis', 'External Oblique', 'Erector Spinae']) },
  { id: 'upper-leg', label: 'Upper Leg', muscles: sidedMuscles(['Vastus Medialis', 'Biceps Femoris', 'Adductor Longus']) },
  { id: 'lower-leg', label: 'Lower Leg', muscles: sidedMuscles(['Gastrocnemius', 'Soleus', 'Tibialis Anterior']) },
]

export interface MuscleGroupNode {
  /** Unique per marker — bilateral groups (e.g. Shoulder) get two nodes that both select the same group. */
  id: string
  groupId: string
  x: number
  y: number
}

/** SVG (viewBox 0 0 200 400) marker positions for the muscle-group picker's stickman, sharing the same silhouette as JointPicker/BodyMap. */
export const MUSCLE_GROUP_NODES: MuscleGroupNode[] = [
  { id: 'chest', groupId: 'chest', x: 100, y: 86 },
  { id: 'back', groupId: 'back', x: 100, y: 116 },
  { id: 'core', groupId: 'core', x: 100, y: 146 },
  { id: 'left-shoulder', groupId: 'shoulder', x: 68, y: 72 },
  { id: 'right-shoulder', groupId: 'shoulder', x: 132, y: 72 },
  { id: 'left-arm', groupId: 'arm', x: 50, y: 84 },
  { id: 'right-arm', groupId: 'arm', x: 150, y: 84 },
  { id: 'left-forearm', groupId: 'forearm', x: 37, y: 128 },
  { id: 'right-forearm', groupId: 'forearm', x: 163, y: 128 },
  { id: 'left-upper-leg', groupId: 'upper-leg', x: 72, y: 205 },
  { id: 'right-upper-leg', groupId: 'upper-leg', x: 128, y: 205 },
  { id: 'left-lower-leg', groupId: 'lower-leg', x: 82, y: 320 },
  { id: 'right-lower-leg', groupId: 'lower-leg', x: 118, y: 320 },
]

export function muscleLabel(muscleId: string): string {
  for (const group of MUSCLE_GROUPS) {
    const found = group.muscles.find((m) => m.id === muscleId)
    if (found) return found.label
  }
  return muscleId
}

const DEFAULT_MUSCLE_EMG_TARGET = 65

/** This muscle's confirmed target %MVC, or a sensible default if the physio hasn't set one for it. */
export function muscleEmgTarget(targets: MuscleEmgTarget[], muscleId: string): number {
  return targets.find((t) => t.muscleId === muscleId)?.targetMvc ?? DEFAULT_MUSCLE_EMG_TARGET
}

/**
 * muscleEmgTargets briefly shipped keyed by hardware podId instead of the
 * current muscleId string, and before that Exercise had a single flat
 * targetEmgMvc instead of an array at all. Migrate either shape in place so
 * data saved during that window (localStorage or Supabase) doesn't crash.
 */
export type LegacyMuscleEmgTarget = { muscleId?: string; podId?: PodId; targetMvc: number }

const LEGACY_POD_TO_MUSCLE_ID: Partial<Record<PodId, string>> = {
  1: 'left-vastus-medialis',
  2: 'right-vastus-medialis',
  7: 'left-lateral-deltoid',
  8: 'right-lateral-deltoid',
}

export function normalizeMuscleEmgTargets(
  raw: LegacyMuscleEmgTarget[] | undefined | null,
  legacyFlatTargetEmgMvc?: number | null,
): MuscleEmgTarget[] {
  if (raw) {
    return raw
      .map((t) => ({ muscleId: t.muscleId ?? (t.podId != null ? LEGACY_POD_TO_MUSCLE_ID[t.podId] : undefined), targetMvc: t.targetMvc }))
      .filter((t): t is MuscleEmgTarget => t.muscleId != null)
  }
  if (legacyFlatTargetEmgMvc != null) {
    return [
      { muscleId: 'left-vastus-medialis', targetMvc: legacyFlatTargetEmgMvc },
      { muscleId: 'right-vastus-medialis', targetMvc: legacyFlatTargetEmgMvc },
    ]
  }
  return []
}
