import { VISION_PREDICTION_CLASSES, type VisionPredictionClass } from '@/lib/visionModel'
import { PLACEHOLDER_RULES, type DashboardRules } from '@/lib/dashboardRules'
import { getDummySessionHistory } from '@/lib/dummySessionHistory'
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

export type PatientStatus = 'needs-attention' | 'inactive' | 'not-scored' | 'on-track' | 'no-sessions'

export interface PatientSummary {
  status: PatientStatus
  /** Plain-language reasons behind the status, e.g. "Good form 48%". */
  reasons: string[]
  latest: SessionStats | null
  previous: SessionStats | null
  /** Latest minus previous good-form %, in points. */
  goodFormChange: number | null
}

export function summarizePatient(sessions: SessionRecord[], rules: DashboardRules = PLACEHOLDER_RULES, now = Date.now()): PatientSummary {
  if (sessions.length === 0) {
    return { status: 'no-sessions', reasons: [], latest: null, previous: null, goodFormChange: null }
  }
  const latest = sessionStats(sessions[sessions.length - 1], rules)
  const previous = sessions.length > 1 ? sessionStats(sessions[sessions.length - 2], rules) : null
  const goodFormChange =
    latest.goodFormPct !== null && previous?.goodFormPct != null ? latest.goodFormPct - previous.goodFormPct : null

  const { goodFormBelowPct, goodFormDropPts, driftFaultsAtLeast } = rules.needsAttention
  const reasons: string[] = []
  if (latest.goodFormPct !== null && latest.goodFormPct < goodFormBelowPct) reasons.push(`Good form ${latest.goodFormPct}%`)
  if (goodFormChange !== null && goodFormChange <= -goodFormDropPts) reasons.push(`Good form down ${-goodFormChange} pts`)
  if (latest.driftFaults >= driftFaultsAtLeast) reasons.push(`${latest.driftFaults} drift faults`)
  if (reasons.length > 0) return { status: 'needs-attention', reasons, latest, previous, goodFormChange }

  const daysSince = Math.floor((now - latest.session.completedAt) / DAY_MS)
  if (daysSince >= rules.inactiveAfterDays) {
    return { status: 'inactive', reasons: [`No session for ${daysSince} days`], latest, previous, goodFormChange }
  }
  // Without any AI verdicts there's no basis to call form on track.
  if (latest.aiScored === 0) {
    return { status: 'not-scored', reasons: ['AI scored no reps last session'], latest, previous, goodFormChange }
  }
  return { status: 'on-track', reasons: [], latest, previous, goodFormChange }
}
