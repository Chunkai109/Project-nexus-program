import { aiClassOf, isInRange, sessionStats, verdictCounts } from '@/lib/sessionStats'
import { buildRosterRows } from '@/components/dashboard/physioModel'
import { PHYSIO_DEMO_EXERCISES, PHYSIO_DEMO_NOW, PHYSIO_DEMO_PATIENTS, PHYSIO_DEMO_PRESETS, PHYSIO_DEMO_SESSIONS } from './physioDemoData'
import { buildDemoSessions, DEMO_EXERCISES, DEMO_LIVE_VERDICTS } from './patientDemoData'

/** Checks that the demo dataset is internally consistent. Returns a list of problems (empty = all good). */
export function checkDemoData(): { problems: string[]; sessions: number; reps: number } {
  const problems: string[] = []
  const sessions = buildDemoSessions()
  let reps = 0
  if (sessions.length < 35 || sessions.length > 42) problems.push(`expected about 40 sessions, got ${sessions.length}`)
  for (const s of sessions) {
    const st = sessionStats(s)
    reps += st.totalReps
    const perClass = s.reps.filter((r) => aiClassOf(r) !== null).length
    if (perClass + st.unscored !== st.totalReps) problems.push(`${s.id}: verdicts ${perClass} + unscored ${st.unscored} != total ${st.totalReps}`)
    if (st.goodForm > st.aiScored) problems.push(`${s.id}: Perfect ${st.goodForm} > scored ${st.aiScored}`)
    if (st.inRange > st.totalReps) problems.push(`${s.id}: in range ${st.inRange} > total ${st.totalReps}`)
    if (st.inRange !== s.reps.filter((r) => isInRange(r, s)).length) problems.push(`${s.id}: in-range count mismatch`)
    if (st.totalReps < 10 || st.totalReps > 36) problems.push(`${s.id}: ${st.totalReps} reps is outside 10-36`)
    if (s.durationSec < 240 || s.durationSec > 720) problems.push(`${s.id}: duration ${s.durationSec}s is outside 4-12 min`)
    for (const r of s.reps) if (r.angle < 0 || r.angle > 135) problems.push(`${s.id} rep ${r.rep}: angle ${r.angle} is outside 0-135`)
    if (!DEMO_EXERCISES.some((e) => e.id === s.exerciseId)) problems.push(`${s.id}: unknown exercise ${s.exerciseId}`)
  }
  for (const e of DEMO_EXERCISES) {
    if (e.therapistNote.length > 200) problems.push(`${e.id}: note over 200 characters`)
    if (e.setupInstructions.length > 500) problems.push(`${e.id}: setup instructions over 500 characters`)
  }
  const first = DEMO_EXERCISES[0]
  if (DEMO_LIVE_VERDICTS.length !== first.sets * first.reps) problems.push('live script length does not match sets x reps')
  return { problems, sessions: sessions.length, reps }
}

/**
 * Checks the physio demo (physioDemoData.ts): every session adds up, angles
 * stay within 0–135°, every patient has at most 40 sessions, and every
 * roster status appears at least once. Returns problems (empty = all good).
 */
export function checkPhysioDemoData(): { problems: string[]; patients: number; sessions: number; reps: number; statuses: Record<string, number> } {
  const problems: string[] = []
  let reps = 0
  for (const s of PHYSIO_DEMO_SESSIONS) {
    const st = sessionStats(s)
    reps += st.totalReps
    const { counts, unscored } = verdictCounts(s)
    const perClass = Object.values(counts).reduce((a, b) => a + b, 0)
    if (perClass + unscored !== st.totalReps) problems.push(`${s.id}: verdicts ${perClass} + not scored ${unscored} != total ${st.totalReps}`)
    if (st.inRange > st.totalReps) problems.push(`${s.id}: in range ${st.inRange} > total ${st.totalReps}`)
    if (st.totalReps < 10 || st.totalReps > 36) problems.push(`${s.id}: ${st.totalReps} reps is outside 10-36`)
    for (const r of s.reps) if (r.angle < 0 || r.angle > 135) problems.push(`${s.id} rep ${r.rep}: angle ${r.angle} is outside 0-135`)
    if (!PHYSIO_DEMO_EXERCISES.some((e) => e.id === s.exerciseId && e.assignedPatientId === s.patientId)) problems.push(`${s.id}: not on one of the patient's plans`)
  }
  if (PHYSIO_DEMO_PATIENTS.length !== 12) problems.push(`expected 12 patients, got ${PHYSIO_DEMO_PATIENTS.length}`)
  if (PHYSIO_DEMO_PRESETS.length !== 4) problems.push(`expected 4 presets, got ${PHYSIO_DEMO_PRESETS.length}`)
  for (const p of PHYSIO_DEMO_PATIENTS) {
    const n = PHYSIO_DEMO_SESSIONS.filter((s) => s.patientId === p.id).length
    if (n > 40) problems.push(`${p.id}: ${n} sessions is over 40`)
    if (!p.name.startsWith('Demo patient')) problems.push(`${p.id}: name must start with "Demo patient"`)
  }
  if (!PHYSIO_DEMO_PATIENTS.some((p) => new Set(PHYSIO_DEMO_SESSIONS.filter((s) => s.patientId === p.id).map((s) => s.exerciseId)).size >= 2))
    problems.push('no patient has sessions on two exercises')
  const rows = buildRosterRows(PHYSIO_DEMO_PATIENTS, PHYSIO_DEMO_SESSIONS, PHYSIO_DEMO_NOW)
  const statuses: Record<string, number> = { 'needs-attention': 0, 'check-camera': 0, inactive: 0, 'on-track': 0 }
  for (const r of rows) statuses[r.status] += 1
  for (const [s, n] of Object.entries(statuses)) if (n === 0) problems.push(`status ${s} never appears`)
  return { problems, patients: PHYSIO_DEMO_PATIENTS.length, sessions: PHYSIO_DEMO_SESSIONS.length, reps, statuses }
}
