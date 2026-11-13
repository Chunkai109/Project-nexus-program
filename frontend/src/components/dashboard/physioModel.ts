/**
 * Display-only calculations for the physio portal. Every number here comes
 * from recorded sessions through lib/sessionStats.ts; nothing is seeded,
 * random or estimated. When there is not enough data the result says so
 * (null, or a "Not enough sessions" line) instead of filling a value in.
 */
import { PLACEHOLDER_RULES } from '@/lib/dashboardRules'
import { sessionStats, summarizePatient, verdictCounts, type SessionStats } from '@/lib/sessionStats'
import { VISION_PREDICTION_CLASSES, type VisionPredictionClass } from '@/lib/visionModel'
import { presetUsage } from '@/lib/planCompare'
import type { Exercise, PatientRecord, SessionRecord } from '@/types'

const DAY_MS = 24 * 60 * 60 * 1000

/** The four statuses the roster shows. A patient with no sessions is Inactive. */
export type RosterStatus = 'needs-attention' | 'check-camera' | 'inactive' | 'on-track'

export const STATUS_ORDER: Record<RosterStatus, number> = { 'needs-attention': 0, 'check-camera': 1, inactive: 2, 'on-track': 3 }

/** How many sessions of one exercise the roster's trend line covers. */
export const TREND_SESSIONS = 6

export interface RosterRow {
  patient: PatientRecord
  status: RosterStatus
  /** One plain line saying why, e.g. "5 drift faults last session". Null for On track. */
  reason: string | null
  latest: SessionStats | null
  /** Real change in good form %, against the previous session of the same exercise. */
  goodFormChange: number | null
  /** Good form % of the latest exercise's last sessions, oldest first. */
  trend: (number | null)[]
  sessionCount: number
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`
}

/** A patient's own recorded sessions, oldest first. */
export function sessionsOf(patientId: string, sessions: SessionRecord[]): SessionRecord[] {
  return sessions.filter((s) => s.patientId === patientId).sort((a, b) => a.completedAt - b.completedAt)
}

/** Status and reason, using the placeholder rules in their fixed order (see lib/sessionStats summarizePatient). */
export function statusOf(history: SessionRecord[], now = Date.now()): { status: RosterStatus; reason: string | null; latest: SessionStats | null } {
  if (history.length === 0) return { status: 'inactive', reason: 'No sessions yet', latest: null }
  const summary = summarizePatient(history, PLACEHOLDER_RULES, now)
  const latest = summary.latest!
  switch (summary.status) {
    case 'inactive':
      return { status: 'inactive', reason: `No session for ${Math.floor((now - latest.session.completedAt) / DAY_MS)} days`, latest }
    case 'check-camera':
      return { status: 'check-camera', reason: `AI scored ${latest.aiScored} of ${plural(latest.totalReps, 'rep')}`, latest }
    case 'needs-attention':
      return latest.driftFaults >= PLACEHOLDER_RULES.needsAttention.driftFaultsAtLeast
        ? { status: 'needs-attention', reason: `${plural(latest.driftFaults, 'drift fault')} last session`, latest }
        : { status: 'needs-attention', reason: `Good form ${latest.goodFormPct}% last session`, latest }
    case 'on-track':
      return { status: 'on-track', reason: null, latest }
    default:
      return { status: 'inactive', reason: 'No sessions yet', latest: null }
  }
}

/** Good-form change between the latest session and the previous session of the same exercise. */
export function goodFormChangeOf(history: SessionRecord[], latest: SessionStats | null): number | null {
  if (!latest || latest.goodFormPct === null) return null
  const earlier = history.filter((h) => h.exerciseId === latest.session.exerciseId && h.completedAt < latest.session.completedAt)
  const prev = earlier.length > 0 ? sessionStats(earlier[earlier.length - 1]).goodFormPct : null
  return prev === null ? null : latest.goodFormPct - prev
}

export function trendOf(history: SessionRecord[], latest: SessionStats | null, count = TREND_SESSIONS): (number | null)[] {
  if (!latest) return []
  return history
    .filter((h) => h.exerciseId === latest.session.exerciseId)
    .slice(-count)
    .map((s) => sessionStats(s).goodFormPct)
}

export function buildRosterRows(patients: PatientRecord[], sessions: SessionRecord[], now = Date.now()): RosterRow[] {
  return patients.map((patient) => {
    const history = sessionsOf(patient.id, sessions)
    const { status, reason, latest } = statusOf(history, now)
    return { patient, status, reason, latest, goodFormChange: goodFormChangeOf(history, latest), trend: trendOf(history, latest), sessionCount: history.length }
  })
}

/** Default roster order: status order, then the most recent session first. */
export function byStatusThenRecent(a: RosterRow, b: RosterRow): number {
  return STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (b.latest?.session.completedAt ?? 0) - (a.latest?.session.completedAt ?? 0)
}

// ---------------------------------------------------------------- chart takeaways

/** "Good form up 12 pts over the last 4 sessions", from the first and last scored session shown. */
export function progressTakeaway(stats: SessionStats[]): string {
  const scored = stats.filter((s) => s.goodFormPct !== null)
  if (stats.length < 2 || scored.length < 2) return 'Not enough sessions yet'
  const delta = scored[scored.length - 1].goodFormPct! - scored[0].goodFormPct!
  const span = `over the last ${stats.length} sessions`
  if (delta === 0) return `Good form unchanged ${span}`
  return `Good form ${delta > 0 ? 'up' : 'down'} ${plural(Math.abs(delta), 'pt')} ${span}`
}

export function repAnglesTakeaway(latest: SessionStats): string {
  const s = latest.session
  return `${latest.inRange} of ${plural(latest.totalReps, 'rep')} peaked inside ${s.targetMin}–${s.targetMax}°`
}

/** Most common non-Perfect verdict, or a plain line when there is none. */
export function verdictTakeaway(session: SessionRecord): string {
  const { counts } = verdictCounts(session)
  const scored = Object.values(counts).reduce((a, b) => a + b, 0)
  if (scored === 0) return 'The AI scored no reps in this session'
  return faultLine(counts, scored)
}

function faultLine(counts: Record<VisionPredictionClass, number>, scored: number): string {
  const faults = VISION_PREDICTION_CLASSES.filter((c) => !PLACEHOLDER_RULES.goodFormVerdicts.includes(c) && counts[c] > 0).sort((a, b) => counts[b] - counts[a])
  if (faults.length === 0) return `No faults. Every scored rep was ${PLACEHOLDER_RULES.goodFormVerdicts.join(' or ')}`
  const top = faults[0]
  void scored
  return `Most common fault: ${top} (${plural(counts[top], 'rep')})`
}

// ---------------------------------------------------------------- preset results

export const RESULTS_WINDOW_DAYS = 30

export interface PresetResults {
  patientsUsing: number
  /** Patient plans copied from this preset. */
  planIds: string[]
  sessions: SessionRecord[]
  totalReps: number
  scored: number
  goodForm: number
  unscored: number
  inRange: number
  driftFaults: number
  /** Pooled: Perfect ÷ scored reps across every session. Null when nothing was scored. */
  goodFormPct: number | null
  inRangePct: number | null
  driftPerSession: number | null
  verdicts: Record<VisionPredictionClass, number>
  verdictTakeaway: string
  /** One row per patient with a plan from this preset. */
  patients: { patient: PatientRecord; status: RosterStatus; reason: string | null; lastSession: SessionStats | null }[]
}

/** Pools every session, in the last 30 days, of patient plans whose basedOnPresetId is this preset. */
export function presetResults(preset: Exercise, exercises: Exercise[], patients: PatientRecord[], allSessions: SessionRecord[], now = Date.now()): PresetResults {
  const plans = exercises.filter((e) => e.basedOnPresetId === preset.id && e.assignedPatientId)
  const planIds = plans.map((p) => p.id)
  const since = now - RESULTS_WINDOW_DAYS * DAY_MS
  const sessions = allSessions.filter((s) => planIds.includes(s.exerciseId) && s.completedAt >= since).sort((a, b) => a.completedAt - b.completedAt)
  const stats = sessions.map((s) => sessionStats(s))
  const sum = (f: (s: SessionStats) => number) => stats.reduce((a, s) => a + f(s), 0)
  const totalReps = sum((s) => s.totalReps)
  const scored = sum((s) => s.aiScored)
  const goodForm = sum((s) => s.goodForm)
  const inRange = sum((s) => s.inRange)
  const driftFaults = sum((s) => s.driftFaults)
  const verdicts = Object.fromEntries(VISION_PREDICTION_CLASSES.map((c) => [c, 0])) as Record<VisionPredictionClass, number>
  for (const s of sessions) {
    const { counts } = verdictCounts(s)
    for (const c of VISION_PREDICTION_CLASSES) verdicts[c] += counts[c]
  }
  const patientIds = [...new Set(plans.map((p) => p.assignedPatientId!))]
  const rows = patientIds
    .map((id) => patients.find((p) => p.id === id))
    .filter((p): p is PatientRecord => !!p)
    .map((patient) => {
      const history = sessionsOf(patient.id, allSessions)
      const { status, reason } = statusOf(history, now)
      const onPreset = history.filter((h) => planIds.includes(h.exerciseId))
      return { patient, status, reason, lastSession: onPreset.length ? sessionStats(onPreset[onPreset.length - 1]) : null }
    })
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (b.lastSession?.session.completedAt ?? 0) - (a.lastSession?.session.completedAt ?? 0))
  return {
    patientsUsing: presetUsage(preset.id, exercises),
    planIds,
    sessions,
    totalReps,
    scored,
    goodForm,
    unscored: totalReps - scored,
    inRange,
    driftFaults,
    goodFormPct: scored === 0 ? null : Math.round((goodForm / scored) * 100),
    inRangePct: totalReps === 0 ? null : Math.round((inRange / totalReps) * 100),
    driftPerSession: sessions.length === 0 ? null : Math.round((driftFaults / sessions.length) * 10) / 10,
    verdicts,
    verdictTakeaway: scored === 0 ? 'The AI scored no reps on this preset yet' : faultLine(verdicts, scored),
    patients: rows,
  }
}

export function bodyRegionLabel(region: Exercise['bodyRegion']): string {
  return { upper: 'Upper body', lower: 'Lower body', core: 'Core', full: 'Full body' }[region]
}

export { plural }
