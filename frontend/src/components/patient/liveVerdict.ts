import { aiClassOf } from '@/lib/sessionStats'
import type { RepSample } from '@/types'

/** What the Live screen shows for the most recently finished rep. */
export type VerdictDisplay =
  | { kind: 'waiting' }
  | { kind: 'checking' }
  | { kind: 'verdict'; label: string; good: boolean; message?: string }
  | { kind: 'not-scored'; reason?: string }

export type FormCheckStatus = 'idle' | 'capturing' | 'checking' | 'result' | 'insufficient_frames' | 'unavailable'

/**
 * PLACEHOLDER: how long the newest rep may show "Checking…" before it is
 * called "Not scored" when no later rep has started (e.g. the final rep).
 */
export const CHECKING_TIMEOUT_SEC = 8

/** The AI's own sentence from a saved comment such as "Swing (41% good form) — Keep your elbow still". */
export function verdictMessage(aiComment: string | undefined): string | undefined {
  const i = aiComment?.indexOf(' — ') ?? -1
  return i >= 0 ? aiComment!.slice(i + 3).trim() || undefined : undefined
}

/**
 * The AI answers a moment after a rep ends, so the newest rep reads
 * "Checking…" first. It becomes "Not scored" only when the next rep has
 * started with still no verdict, the camera AI is known to be off, or the
 * timeout passes. That stops every rep flashing "Not scored" before "Perfect".
 */
export function verdictFor(lastRep: RepSample | undefined, status: FormCheckStatus, secondsSinceRep: number): VerdictDisplay {
  if (!lastRep) return { kind: 'waiting' }
  if (lastRep.aiComment) {
    const cls = aiClassOf(lastRep)
    if (cls) return { kind: 'verdict', label: cls, good: cls === 'Perfect', message: verdictMessage(lastRep.aiComment) }
    return { kind: 'not-scored', reason: "The camera couldn't judge that rep." }
  }
  if (status === 'unavailable') return { kind: 'not-scored', reason: 'Camera AI is off.' }
  if (status === 'insufficient_frames') return { kind: 'not-scored', reason: 'That rep was too fast for the camera.' }
  if (status === 'capturing') return { kind: 'not-scored' } // the next rep has started
  if (secondsSinceRep >= CHECKING_TIMEOUT_SEC) return { kind: 'not-scored' }
  return { kind: 'checking' }
}

/** "Set 1 of 3, rep 7 of 10", worked out from the running rep total. The app does not detect rests. */
export function setProgress(repCount: number, sets: number, repsPerSet: number) {
  const total = sets * repsPerSet
  if (repsPerSet <= 0 || sets <= 0) return { allDone: false, setNumber: 1, repInSet: repCount, justFinishedSet: false, total }
  if (repCount >= total) return { allDone: true, setNumber: sets, repInSet: repsPerSet, justFinishedSet: false, total }
  const repInSet = repCount % repsPerSet
  return { allDone: false, setNumber: Math.floor(repCount / repsPerSet) + 1, repInSet, justFinishedSet: repInSet === 0 && repCount > 0, total }
}
