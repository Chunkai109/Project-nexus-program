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
