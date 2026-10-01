import type { PodId } from '@/types'
import { PODS } from '@/lib/mockData'
import { virtualNodeLabel } from '@/lib/joints'

export function podLabel(id: PodId): string {
  return PODS.find((p) => p.id === id)?.location ?? virtualNodeLabel(id) ?? `Pod ${id}`
}
