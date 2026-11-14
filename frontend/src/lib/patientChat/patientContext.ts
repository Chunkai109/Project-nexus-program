import { aiClassOf, isInRange, sessionStats, verdictCounts } from '@/lib/sessionStats'
import { PLACEHOLDER_RULES } from '@/lib/dashboardRules'
import { VISION_PREDICTION_CLASSES } from '@/lib/visionModel'
import type { Exercise, SessionRecord } from '@/types'

const DAY_MS = 24 * 60 * 60 * 1000
/** Older sessions are summarised as a count only, to keep the request small. */
const MAX_SESSIONS = 30

export interface PatientContextInput {
  /** The patient's sessions, oldest first. */
  history: SessionRecord[]
  /** True when `history` is generated demo data, not real sessions. */
  isDemo: boolean
  plans: Exercise[]
  now: number
}

function daysAgo(at: number, now: number): string {
  const d = Math.max(0, Math.floor((now - at) / DAY_MS))
  return d === 0 ? 'today' : d === 1 ? '1 day ago' : `${d} days ago`
}

const pct = (v: number | null) => (v === null ? 'n/a' : `${v}%`)

/**
 * The patient summary the chat sends to the AI: plans, per-session numbers
 * and the latest session rep by rep.
 *
 * Privacy: it never includes the patient's name, email or id, the physio's
 * free-text notes, or calendar dates (only "N days ago"). Muscle activation
 * is left out because it is currently estimated from the elbow angle, not
 * measured.
 */
export function buildPatientContext({ history, isDemo, plans, now }: PatientContextInput): string {
  const lines: string[] = []
  lines.push('Patient: "this patient" (name and contact details are not shared).')
  lines.push(
    isDemo
      ? 'DATA SOURCE: DEMO DATA. This patient has no real sessions yet; the sessions below are generated examples, not their real results.'
      : 'Data source: real recorded sessions.',
  )
  lines.push(`Good form rule (placeholder until a physiotherapist confirms it): reps scored ${PLACEHOLDER_RULES.goodFormVerdicts.join(' or ')}, out of the reps the AI scored.`)

  lines.push('')
  lines.push(`Exercise plans (${plans.length}):`)
  if (plans.length === 0) lines.push('- None assigned.')
  for (const p of plans) {
    const range = p.angleConfigs[0]
    const target = range ? `target elbow range ${range.targetMin}-${range.targetMax} degrees` : 'no elbow target set'
    lines.push(`- "${p.title}": ${p.sets} sets x ${p.reps} reps, ${target}, drift tolerance ${p.driftToleranceDeg} degrees.`)
  }

  lines.push('')
  const shownFrom = Math.max(0, history.length - MAX_SESSIONS)
  lines.push(`Sessions: ${history.length} in total, oldest first.${shownFrom > 0 ? ` Sessions 1-${shownFrom} are older and not listed.` : ''}`)
  if (history.length === 0) lines.push('- No sessions yet.')
  lines.push('Columns: session | when | exercise | reps | in range | AI scored | good form | drift faults | duration | AI verdict counts')
  history.forEach((s, i) => {
    if (i < shownFrom) return
    const st = sessionStats(s)
    const { counts, unscored } = verdictCounts(s)
    const verdicts = [...VISION_PREDICTION_CLASSES.filter((c) => counts[c] > 0).map((c) => `${c} ${counts[c]}`), `not scored ${unscored}`].join(', ')
    lines.push(
      `Session ${i + 1} | ${daysAgo(s.completedAt, now)} | "${s.exerciseTitle}" target ${s.targetMin}-${s.targetMax} | ${st.totalReps} | ${st.inRange} (${pct(st.inRangePct)}) | ${st.aiScored} | ${pct(st.goodFormPct)} | ${st.driftFaults} | ${Math.round(s.durationSec / 60)} min | ${verdicts}`,
    )
  })

  const latest = history[history.length - 1]
  if (latest) {
    lines.push('')
    lines.push(`Latest session (Session ${history.length}, ${daysAgo(latest.completedAt, now)}), rep by rep:`)
    lines.push('Columns: rep | peak elbow angle | in range | drift fault | AI verdict')
    for (const r of latest.reps) {
      lines.push(`${r.rep} | ${Math.round(r.angle)} | ${isInRange(r, latest) ? 'yes' : 'no'} | ${r.faultActive ? 'yes' : 'no'} | ${aiClassOf(r) ?? 'not scored'}`)
    }
  }
  return lines.join('\n')
}
