import type { PodId } from '@/types'
import { PODS } from '@/lib/mockData'
import type { Side } from '@/lib/pose/poseMetrics'

/** Pods 1/3/5 are wired to the left limb, 2/4/6 to the right, per the hardware layout in mockData. */
export function podSide(id: PodId): Side {
  return id % 2 === 1 ? 'left' : 'right'
}

/** The knee-joint pod (IMU+Haptics) for a given side — Pod 3 left, Pod 4 right. */
export function kneePodForSide(side: Side): PodId {
  return side === 'left' ? 3 : 4
}

export function podLabel(id: PodId): string {
  return PODS.find((p) => p.id === id)?.location ?? `Pod ${id}`
}
