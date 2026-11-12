import { aiClassOf, type SessionStats } from '@/lib/sessionStats'
import { verdictMessage } from './liveVerdict'

/**
 * PLACEHOLDER rules until a physiotherapist confirms them. They match the
 * physio dashboard's placeholders (camera scored half or fewer; 3+ drift
 * faults), plus one more for range.
 */
export const TIP_RULES = {
  cameraScoredAtMost: 0.5,
  driftFaultsAtLeast: 3,
  inRangeBelowPct: 70,
}

/** The one thing to fix next time: the first rule that matches, most important first. */
export function sessionTip(stats: SessionStats): string {
  const { session } = stats
  if (stats.totalReps === 0) return 'No reps were recorded in this session.'
  if (stats.aiScored <= stats.totalReps * TIP_RULES.cameraScoredAtMost) {
    return `The camera only scored ${stats.aiScored} of your ${stats.totalReps} reps. Next time, stand so your whole arm is in view of the camera.`
  }
  if (stats.driftFaults >= TIP_RULES.driftFaultsAtLeast) {
    return `Keep your upper arm still. It moved too far on ${stats.driftFaults} reps.`
  }
  const counts = new Map<string, number>()
  for (const rep of session.reps) {
    const cls = aiClassOf(rep)
    if (cls && cls !== 'Perfect') counts.set(cls, (counts.get(cls) ?? 0) + 1)
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
  if (top) {
    const [cls, n] = top
    const message = verdictMessage(session.reps.find((r) => aiClassOf(r) === cls)?.aiComment)
    // Only the AI's own sentence is repeated. Without one, no advice is invented: the patient is pointed to their physio.
    return `${n} rep${n === 1 ? ' was' : 's were'} scored "${cls}". ${message ?? 'Ask your physiotherapist what to change.'}`
  }
  if (stats.inRangePct !== null && stats.inRangePct < TIP_RULES.inRangeBelowPct) {
    return `Curl into your target range (${session.targetMin}–${session.targetMax}°). ${stats.inRange} of ${stats.totalReps} reps reached it.`
  }
  return 'Nothing to fix. Keep going like this.'
}
