/**
 * Deterministic placeholder session history for a patient who hasn't
 * completed any real session yet, so Session Analytics' "Historical
 * Telemetry Review" has something representative to show instead of an
 * empty state. Derived purely from the patient's `id` (same approach as
 * dummyMedicalProfile.ts) -- nothing here is a real recorded session, and
 * nothing is written to the sessions table. The instant a patient
 * completes a real session, TelemetrySection.tsx stops calling this and
 * switches to their actual recorded data.
 *
 * Modeled on the default bicep curl protocol's real measured range (0deg
 * full extension, target corridor 100-135deg -- see
 * buildDefaultBicepCurlExercise() in AppDataContext.tsx), with EMG derived
 * from each rep's angle the same way LiveSession.tsx's emgFromFlexion()
 * does (rises/peaks with the angle), so the shape of the demo charts looks
 * like a real session's would.
 */
import { hashSeed, mulberry32 } from './seededRandom'
import type { SymmetryPoint, TelemetryPoint } from '@/types'

const TARGET_MIN = 100
const TARGET_MAX = 135
const EMG_FLEX_PEAK_DEG = 135
const SESSION_COUNT = 6
const DAY_MS = 24 * 60 * 60 * 1000

function emgFromFlexion(flexDeg: number, rand: () => number): number {
  const pct = Math.max(0, Math.min(1, flexDeg / EMG_FLEX_PEAK_DEG)) * 100
  const noise = (rand() - 0.5) * 6
  return Math.round(Math.max(0, Math.min(100, pct + noise)))
}

export interface DummySessionHistory {
  trendData: TelemetryPoint[]
  symmetryData: SymmetryPoint[]
  latestExerciseTitle: string
  latestRepCount: number
  latestCompletedAt: number
}

export function getDummySessionHistory(patientId: string): DummySessionHistory {
  const rand = mulberry32(hashSeed(patientId))

  const symmetryData: SymmetryPoint[] = []
  let latestTrend: TelemetryPoint[] = []
  let latestRepCount = 0

  for (let s = 0; s < SESSION_COUNT; s++) {
    const repCount = 8 + Math.floor(rand() * 5) // 8-12 reps
    const sessionTrend: TelemetryPoint[] = []
    let emgSum = 0
    for (let r = 1; r <= repCount; r++) {
      // Peak angle per rep: mostly inside the corridor, with occasional
      // under/overshoot either side -- a plausibly real-looking spread,
      // not every rep landing perfectly in the target band.
      const angle = Math.round(TARGET_MIN - 6 + rand() * (TARGET_MAX - TARGET_MIN + 16))
      sessionTrend.push({ t: r, angle, targetMin: TARGET_MIN, targetMax: TARGET_MAX })
      emgSum += emgFromFlexion(angle, rand)
    }
    // Same value for left/right, matching how a real session's RepSample
    // actually looks on this rig: one EMG channel duplicated into both
    // fields (see the emgLeft/emgRight comment in LiveSession.tsx) --
    // faking an asymmetry here would misleadingly imply a clinical finding
    // this placeholder data has no basis for.
    const avgEmg = Math.round(emgSum / repCount)
    symmetryData.push({ session: `S${s + 1}`, left: avgEmg, right: avgEmg })

    if (s === SESSION_COUNT - 1) {
      latestTrend = sessionTrend
      latestRepCount = repCount
    }
  }

  return {
    trendData: latestTrend,
    symmetryData,
    latestExerciseTitle: 'Bicep Curl',
    latestRepCount,
    latestCompletedAt: Date.now() - DAY_MS,
  }
}
