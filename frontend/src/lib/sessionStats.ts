import { VISION_PREDICTION_CLASSES, type VisionPredictionClass } from '@/lib/visionModel'
import { PLACEHOLDER_RULES, type DashboardRules } from '@/lib/dashboardRules'
import { getDummySessionHistory } from '@/lib/dummySessionHistory'
import { hashSeed, mulberry32 } from '@/lib/seededRandom'
import type { RepSample, SessionRecord } from '@/types'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The AI class of a rep, read from its saved comment. LiveSession.tsx stores
 * e.g. "Perfect (92% good form) — …", so the class is the first word. Null
 * when the rep has no verdict or the model rejected the input.
 */
export function aiClassOf(rep: RepSample): VisionPredictionClass | null {
  const first = rep.aiComment?.trim().split(/\s+/)[0]
  return (VISION_PREDICTION_CLASSES as readonly string[]).includes(first ?? '') ? (first as VisionPredictionClass) : null
}

export function isInRange(rep: RepSample, session: SessionRecord): boolean {
  return rep.angle >= session.targetMin && rep.angle <= session.targetMax
}

export interface SessionStats {
  session: SessionRecord
  totalReps: number
  /** Reps the AI gave a verdict for. Good-form % is out of these, not all reps. */
  aiScored: number
  /** totalReps - aiScored. */
  unscored: number
  goodForm: number
  /** Null when the AI scored no reps, so there's nothing to judge. */
  goodFormPct: number | null
  inRange: number
  inRangePct: number | null
  driftFaults: number
}

function pct(part: number, whole: number): number | null {
  return whole === 0 ? null : Math.round((part / whole) * 100)
}

export function sessionStats(session: SessionRecord, rules: DashboardRules = PLACEHOLDER_RULES): SessionStats {
  const verdicts = session.reps.map(aiClassOf)
  const aiScored = verdicts.filter((v) => v !== null).length
  const goodForm = verdicts.filter((v) => v !== null && rules.goodFormVerdicts.includes(v)).length
  const inRange = session.reps.filter((r) => isInRange(r, session)).length
  return {
    session,
    totalReps: session.reps.length,
    aiScored,
    unscored: session.reps.length - aiScored,
    goodForm,
    goodFormPct: pct(goodForm, aiScored),
    inRange,
    inRangePct: pct(inRange, session.reps.length),
    driftFaults: session.reps.filter((r) => r.faultActive).length,
  }
}

/** Count of each AI class in a session, plus reps with no verdict. */
export function verdictCounts(session: SessionRecord): { counts: Record<VisionPredictionClass, number>; unscored: number } {
  const counts = Object.fromEntries(VISION_PREDICTION_CLASSES.map((c) => [c, 0])) as Record<VisionPredictionClass, number>
  let unscored = 0
  for (const rep of session.reps) {
    const v = aiClassOf(rep)
    if (v) counts[v] += 1
    else unscored += 1
  }
  return { counts, unscored }
}

/**
 * A patient's sessions, oldest first. Falls back to clearly-labelled
 * placeholder history (isDemo) when they haven't completed a real session.
 */
export function historyFor(patientId: string, allSessions: SessionRecord[]): { sessions: SessionRecord[]; isDemo: boolean } {
  const real = allSessions.filter((s) => s.patientId === patientId).sort((a, b) => a.completedAt - b.completedAt)
  if (real.length > 0) return { sessions: real, isDemo: false }
  return { sessions: getDummySessionHistory(patientId), isDemo: true }
}

/**
 * DEMO DATA, not a measurement: the good-form "vs last session" change shown
 * on the dashboard, a whole number from -15 to +15. Seeded from the patient
 * and session ids so it stays the same across reloads. Always shown with a
 * "Demo" tag, and never used to decide a patient's status.
 */
export function demoGoodFormChange(patientId: string, sessionId: string): number {
  const rand = mulberry32(hashSeed(`${patientId}:${sessionId}:good-form-change`))
  return Math.floor(rand() * 31) - 15
}

export type PatientStatus = 'needs-attention' | 'check-camera' | 'inactive' | 'on-track' | 'no-sessions'

export interface PatientSummary {
  status: PatientStatus
  /** Plain-language reasons behind the status, e.g. "Good form 48%". */
  reasons: string[]
  latest: SessionStats | null
  previous: SessionStats | null
  /** DEMO DATA: see demoGoodFormChange. Null when there's no earlier session or no good-form score to compare. */
  demoGoodFormChange: number | null
}

/**
 * Placeholder status rules, first match wins: Inactive, then Needs attention
 * (drift faults), then Check camera, then Needs attention (good form), then
 * On track. The demo good-form change never affects the status.
 */
export function summarizePatient(sessions: SessionRecord[], rules: DashboardRules = PLACEHOLDER_RULES, now = Date.now()): PatientSummary {
  if (sessions.length === 0) {
    return { status: 'no-sessions', reasons: [], latest: null, previous: null, demoGoodFormChange: null }
  }
  const latest = sessionStats(sessions[sessions.length - 1], rules)
  const previous = sessions.length > 1 ? sessionStats(sessions[sessions.length - 2], rules) : null
  const demoChange =
    previous && latest.goodFormPct !== null ? demoGoodFormChange(latest.session.patientId, latest.session.id) : null
  const result = (status: PatientStatus, reasons: string[]): PatientSummary => ({
    status,
    reasons,
    latest,
    previous,
    demoGoodFormChange: demoChange,
  })

  const daysSince = Math.floor((now - latest.session.completedAt) / DAY_MS)
  if (daysSince >= rules.inactiveAfterDays) return result('inactive', [`No session for ${daysSince} days`])

  const { goodFormBelowPct, driftFaultsAtLeast } = rules.needsAttention
  if (latest.driftFaults >= driftFaultsAtLeast) return result('needs-attention', [`${latest.driftFaults} drift faults`])

  if (latest.aiScored <= latest.totalReps * rules.checkCameraScoredAtMost) {
    return result('check-camera', [`AI scored ${latest.aiScored} of ${latest.totalReps} reps`])
  }

  if (latest.goodFormPct !== null && latest.goodFormPct < goodFormBelowPct) {
    return result('needs-attention', [`Good form ${latest.goodFormPct}%`])
  }
  return result('on-track', [])
}
