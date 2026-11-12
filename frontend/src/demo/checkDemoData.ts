import { aiClassOf, isInRange, sessionStats } from '@/lib/sessionStats'
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
