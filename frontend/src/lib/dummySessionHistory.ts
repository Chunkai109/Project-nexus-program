/**
 * Deterministic placeholder session history for a patient who hasn't
 * completed a real session yet, so the physio dashboard has something
 * representative to show. Derived purely from the patient's id: nothing here
 * is a real recorded session, nothing is written to the database, and every
 * screen that shows it labels it "Demo data". It stops being used the moment
 * the patient completes a real session (see historyFor in sessionStats.ts).
 *
 * Modelled on the default Bicep Curl (target 100-135deg). Each rep gets a
 * placeholder AI verdict and drift flag that hang together the way a real
 * session's would: a short rep reads as Half/Incomplete, a drifting rep as
 * Swing/Heave. Patients get different trends and last-session dates so the
 * roster shows a mix of statuses.
 */
import { hashSeed, mulberry32 } from './seededRandom'
import type { RepSample, SessionRecord } from '@/types'

const TARGET_MIN = 100
const TARGET_MAX = 135
const EMG_FLEX_PEAK_DEG = 135
const SESSION_COUNT = 8
const DAY_MS = 24 * 60 * 60 * 1000

function emgFromFlexion(flexDeg: number, rand: () => number): number {
  const pct = Math.max(0, Math.min(1, flexDeg / EMG_FLEX_PEAK_DEG)) * 100
  const noise = (rand() - 0.5) * 6
  return Math.round(Math.max(0, Math.min(100, pct + noise)))
}

function pick<T>(items: T[], rand: () => number): T {
  return items[Math.floor(rand() * items.length)]
}

export function getDummySessionHistory(patientId: string): SessionRecord[] {
  const rand = mulberry32(hashSeed(patientId))

  // Most demo patients improve; some slip. Some haven't trained lately.
  const startPerfect = 0.35 + rand() * 0.25
  const trendPerSession = rand() < 0.75 ? 0.04 : -0.05
  const lastSessionDaysAgo = rand() < 0.7 ? 1 + Math.floor(rand() * 3) : 8 + Math.floor(rand() * 5)

  const sessions: SessionRecord[] = []
  let daysAgo = lastSessionDaysAgo
  for (let s = SESSION_COUNT - 1; s >= 0; s--) {
    const pPerfect = Math.max(0.1, Math.min(0.9, startPerfect + trendPerSession * s))
    const repCount = 8 + Math.floor(rand() * 5)
    const reps: RepSample[] = []
    for (let r = 1; r <= repCount; r++) {
      const angle = Math.round(TARGET_MIN - 8 + rand() * (TARGET_MAX - TARGET_MIN + 16))
      const drift = rand() < 0.08
      let verdict: string | null
      if (rand() < 0.15) verdict = null // camera missed the rep / AI offline
      else if (drift) verdict = rand() < 0.6 ? 'Swing' : 'Heave'
      else if (angle < TARGET_MIN) verdict = rand() < 0.6 ? 'Half' : 'Incomplete'
      else verdict = rand() < pPerfect ? 'Perfect' : pick(['Drag', 'Swing', 'Heave'], rand)
      const score = verdict === 'Perfect' ? 75 + Math.floor(rand() * 21) : 10 + Math.floor(rand() * 36)
      const emg = emgFromFlexion(angle, rand)
      reps.push({
        rep: r,
        angle,
        emgLeft: emg,
        emgRight: emg,
        faultActive: drift,
        aiComment: verdict ? `${verdict} (${score}% good form)` : undefined,
      })
    }
    sessions.unshift({
      id: `demo-${patientId}-${s}`,
      patientId,
      patientName: '',
      exerciseId: 'demo-bicep-curl',
      exerciseTitle: 'Bicep Curl',
      completedAt: Date.now() - daysAgo * DAY_MS,
      durationSec: repCount * 6,
      targetMin: TARGET_MIN,
      targetMax: TARGET_MAX,
      reps,
    })
    daysAgo += 2 + Math.floor(rand() * 2)
  }
  return sessions
}
