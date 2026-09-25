import type { PodId } from '@/types'
import { PODS } from '@/lib/mockData'
import { virtualNodeLabel } from '@/lib/joints'
import type { Side } from '@/lib/pose/poseMetrics'

/** Odd node ids are wired to the left limb, even to the right — holds for the 6-pod hardware kit and the virtual joint nodes in lib/joints.ts alike. */
export function podSide(id: PodId): Side {
  return id % 2 === 1 ? 'left' : 'right'
}

/** The knee-joint pod (IMU+Haptics) for a given side — Pod 3 left, Pod 4 right. */
export function kneePodForSide(side: Side): PodId {
  return side === 'left' ? 3 : 4
}

export function podLabel(id: PodId): string {
  return PODS.find((p) => p.id === id)?.location ?? virtualNodeLabel(id) ?? `Pod ${id}`
}
