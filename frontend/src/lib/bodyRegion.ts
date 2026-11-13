import type { Exercise } from '@/types'

export type BodyRegion = Exercise['bodyRegion']

export const BODY_REGIONS: { id: BodyRegion; label: string }[] = [
  { id: 'upper', label: 'Upper body' },
  { id: 'lower', label: 'Lower body' },
  { id: 'core', label: 'Core' },
  { id: 'full', label: 'Full body' },
]

/** Which region each muscle group (the labels in lib/muscles.ts) belongs to. */
const REGION_OF_GROUP: Record<string, Exclude<BodyRegion, 'full'>> = {
  Chest: 'upper',
  Back: 'upper',
  Shoulder: 'upper',
  Arm: 'upper',
  Forearm: 'upper',
  'Upper Leg': 'lower',
  'Lower Leg': 'lower',
  Core: 'core',
}

/**
 * The region suggested by the muscle groups picked in Basics: all in one
 * region gives that region; two or more regions, or none picked, gives the
 * full body. The physio can always override it.
 */
export function suggestBodyRegion(muscleGroups: string[]): BodyRegion {
  const regions = new Set(muscleGroups.map((g) => REGION_OF_GROUP[g]).filter(Boolean))
  return regions.size === 1 ? [...regions][0] : 'full'
}

export function isBodyRegion(value: unknown): value is BodyRegion {
  return value === 'upper' || value === 'lower' || value === 'core' || value === 'full'
}
