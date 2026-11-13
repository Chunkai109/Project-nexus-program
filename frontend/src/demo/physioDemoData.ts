/**
 * DEMO DATA for the physio portal preview (/demo/physio/*). None of this is a
 * real patient, clinic or session: names are "Demo patient A" to "Demo
 * patient L", and everything is generated from fixed seeds with
 * hashSeed/mulberry32, so the same screens show the same numbers every time.
 * checkDemoData.ts (checkPhysioDemoData) verifies the totals add up.
 *
 * The generator shapes each patient's latest session so every roster status
 * appears at least once, using the same placeholder rules as the real portal.
 */
import { hashSeed, mulberry32 } from '@/lib/seededRandom'
import { VISION_PREDICTION_CLASSES } from '@/lib/visionModel'
import type { Exercise, PatientRecord, RepSample, SessionRecord } from '@/types'

const DAY_MS = 24 * 60 * 60 * 1000
/** Every demo date is counted back from when the demo was opened. */
export const PHYSIO_DEMO_NOW = Date.now()
const FAULTS = VISION_PREDICTION_CLASSES.filter((c) => c !== 'Perfect')

type Profile = 'drift' | 'low-form' | 'camera' | 'inactive' | 'no-sessions' | 'on-track'

interface PatientPlan {
  letter: string
  profile: Profile
  /** Sessions in total, and how many days ago the last one was. */
  sessions: number
  lastDaysAgo: number
  /** Which presets this patient has a plan from. */
  presets: string[]
}

const PLAN: PatientPlan[] = [
  { letter: 'A', profile: 'drift', sessions: 18, lastDaysAgo: 1, presets: ['preset-curl'] },
  { letter: 'B', profile: 'low-form', sessions: 9, lastDaysAgo: 2, presets: ['preset-curl-light'] },
  { letter: 'C', profile: 'camera', sessions: 12, lastDaysAgo: 0, presets: ['preset-curl'] },
  { letter: 'D', profile: 'inactive', sessions: 14, lastDaysAgo: 9, presets: ['preset-curl'] },
  { letter: 'E', profile: 'no-sessions', sessions: 0, lastDaysAgo: 0, presets: ['preset-curl-light'] },
  { letter: 'F', profile: 'on-track', sessions: 40, lastDaysAgo: 0, presets: ['preset-curl', 'preset-curl-end-range'] },
  { letter: 'G', profile: 'on-track', sessions: 22, lastDaysAgo: 1, presets: ['preset-curl'] },
  { letter: 'H', profile: 'on-track', sessions: 6, lastDaysAgo: 3, presets: ['preset-curl-light'] },
  { letter: 'I', profile: 'on-track', sessions: 31, lastDaysAgo: 2, presets: ['preset-curl-end-range'] },
  { letter: 'J', profile: 'camera', sessions: 4, lastDaysAgo: 4, presets: ['preset-curl-light'] },
  { letter: 'K', profile: 'on-track', sessions: 2, lastDaysAgo: 5, presets: ['preset-curl'] },
  { letter: 'L', profile: 'drift', sessions: 25, lastDaysAgo: 0, presets: ['preset-curl-end-range'] },
]

function preset(id: string, title: string, sets: number, reps: number, estMinutes: number, targetMin: number, targetMax: number, drift: number, region: Exercise['bodyRegion'], editedDaysAgo: number, withMuscles = false): Exercise {
  const createdAt = PHYSIO_DEMO_NOW - 90 * DAY_MS
  return {
    id,
    title,
    muscleGroups: region === 'lower' ? ['Upper Leg'] : ['Arm'],
    sets,
    reps,
    muscleEmgTargets: withMuscles ? [{ muscleId: 'right-biceps-brachii', targetMvc: 60 }] : [],
    therapistNote: 'Demo note. Keep the elbow at your side.',
    setupInstructions: 'Demo setup. Sit side-on to the camera.',
    estMinutes,
    angleConfigs: region === 'lower' ? [] : [{ id: `${id}-angle`, nodeA: 2, nodeB: 3, targetMin, targetMax, faultThresholdDeg: 12 }],
    assignedPatientId: null,
    basedOnPresetId: null,
    driftToleranceDeg: drift,
    bodyRegion: region,
    createdAt,
    updatedAt: PHYSIO_DEMO_NOW - editedDaysAgo * DAY_MS,
    presetSnapshotAt: null,
  }
}

export const PHYSIO_DEMO_PRESETS: Exercise[] = [
  preset('preset-curl', 'Bicep Curl', 3, 10, 5, 100, 135, 22, 'upper', 4, true),
  preset('preset-curl-light', 'Bicep Curl, light', 2, 8, 4, 90, 120, 25, 'upper', 12),
  preset('preset-curl-end-range', 'Bicep Curl, end range', 3, 12, 6, 110, 135, 18, 'upper', 2),
  preset('preset-squat', 'Squats', 3, 15, 6, 0, 0, 22, 'lower', 30),
]

export const PHYSIO_DEMO_PATIENTS: PatientRecord[] = PLAN.map((p) => ({
  id: `demo-patient-${p.letter.toLowerCase()}`,
  name: `Demo patient ${p.letter}`,
  email: `demo-${p.letter.toLowerCase()}@example.com`,
  firstSeenAt: PHYSIO_DEMO_NOW - (p.sessions * 2 + 10) * DAY_MS,
  lastSeenAt: PHYSIO_DEMO_NOW - p.lastDaysAgo * DAY_MS,
}))

/** One plan per patient per preset, copied from the preset like the real Exercise plan tab does. */
export const PHYSIO_DEMO_PLANS: Exercise[] = PLAN.flatMap((p, i) =>
  p.presets.map((presetId) => {
    const base = PHYSIO_DEMO_PRESETS.find((x) => x.id === presetId)!
    const patient = PHYSIO_DEMO_PATIENTS[i]
    return {
      ...base,
      id: `${presetId}--${patient.id}`,
      assignedPatientId: patient.id,
      basedOnPresetId: base.id,
      presetSnapshotAt: base.updatedAt,
      createdAt: patient.firstSeenAt,
      updatedAt: patient.firstSeenAt,
    }
  }),
)

export const PHYSIO_DEMO_EXERCISES: Exercise[] = [...PHYSIO_DEMO_PRESETS, ...PHYSIO_DEMO_PLANS]

interface Knobs {
  inRange: number
  scored: number
  perfect: number
  drift: number
}

/** How a patient's sessions look early on (t = 0) and in their latest session (t = 1). */
function knobs(profile: Profile, t: number): Knobs {
  const lerp = (a: number, b: number) => a + (b - a) * t
  switch (profile) {
    case 'drift':
      return { inRange: lerp(0.55, 0.7), scored: 0.85, perfect: lerp(0.5, 0.7), drift: lerp(0.05, 0.25) }
    case 'low-form':
      return { inRange: lerp(0.6, 0.55), scored: 0.85, perfect: lerp(0.65, 0.42), drift: 0.03 }
    case 'camera':
      return { inRange: 0.7, scored: lerp(0.8, 0.35), perfect: 0.75, drift: 0.03 }
    default:
      return { inRange: lerp(0.5, 0.88), scored: 0.88, perfect: lerp(0.5, 0.86), drift: lerp(0.08, 0.02) }
  }
}

function makeReps(rand: () => number, count: number, k: Knobs, min: number, max: number): RepSample[] {
  return Array.from({ length: count }, (_, i) => {
    const inRange = rand() < k.inRange
    const angle = inRange ? Math.round(min + rand() * (max - min)) : Math.max(0, Math.round(min - 4 - rand() * 30))
    const scored = rand() < k.scored
    const verdict = !scored ? null : rand() < k.perfect ? 'Perfect' : FAULTS[Math.floor(rand() * FAULTS.length)]
    return {
      rep: i + 1,
      angle: Math.min(135, angle),
      emgLeft: 0,
      emgRight: 0,
      faultActive: rand() < k.drift,
      ...(verdict ? { aiComment: `${verdict} (demo verdict)` } : {}),
    }
  })
}

/**
 * Makes the latest session meet its profile exactly, so each status really
 * appears: e.g. a "drift" patient's last session has 3 or more drift faults.
 */
function shapeLatest(reps: RepSample[], profile: Profile): RepSample[] {
  const out = reps.map((r) => ({ ...r }))
  const scoredIdx = () => out.map((r, i) => (r.aiComment ? i : -1)).filter((i) => i >= 0)
  const setVerdict = (i: number, v: string | null) => {
    if (v) out[i].aiComment = `${v} (demo verdict)`
    else delete out[i].aiComment
  }
  if (profile === 'drift') {
    out.forEach((r, i) => (r.faultActive = i < 5))
  } else {
    out.forEach((r, i) => (r.faultActive = r.faultActive && i % 7 === 0))
    if (out.filter((r) => r.faultActive).length > 2) out.forEach((r, i) => (r.faultActive = i === 0))
  }
  if (profile === 'camera') {
    // Leave fewer than half the reps scored.
    out.forEach((_, i) => setVerdict(i, i % 3 === 0 ? (i % 2 ? 'Perfect' : 'Swing') : null))
  } else {
    // More than half scored, so this is not a camera problem.
    out.forEach((r, i) => {
      if (!r.aiComment && i % 4 !== 0) setVerdict(i, 'Perfect')
    })
    const idx = scoredIdx()
    if (profile === 'low-form') idx.forEach((i, k) => setVerdict(i, k % 2 === 0 ? FAULTS[k % FAULTS.length] : 'Perfect'))
    if (profile === 'on-track' || profile === 'inactive') {
      // Keep the generated verdicts; only lift good form to the On track side of the 60% line if needed.
      const perfect = () => idx.filter((i) => out[i].aiComment?.startsWith('Perfect')).length
      for (const i of idx) if (perfect() / idx.length < 0.7 && !out[i].aiComment?.startsWith('Perfect')) setVerdict(i, 'Perfect')
    }
  }
  return out
}

function buildSessions(): SessionRecord[] {
  const all: SessionRecord[] = []
  PLAN.forEach((p, pi) => {
    if (p.sessions === 0) return
    const patient = PHYSIO_DEMO_PATIENTS[pi]
    const plans = PHYSIO_DEMO_PLANS.filter((x) => x.assignedPatientId === patient.id)
    const rand = mulberry32(hashSeed(`physio-demo:${patient.id}`))
    // Sessions every 1 to 3 days, ending lastDaysAgo days before now.
    let day = p.lastDaysAgo
    const days: number[] = []
    for (let i = 0; i < p.sessions; i++) {
      days.unshift(day)
      day += 1 + Math.floor(rand() * 3)
    }
    days.forEach((daysAgo, i) => {
      // A patient with two plans alternates between them; the last session is on the first plan.
      const plan = plans[(p.sessions - 1 - i) % plans.length]
      const range = plan.angleConfigs[0]
      const t = p.sessions === 1 ? 1 : i / (p.sessions - 1)
      const count = 10 + Math.floor(rand() * 27)
      let reps = makeReps(rand, count, knobs(p.profile, t), range.targetMin, range.targetMax)
      if (i === p.sessions - 1) reps = shapeLatest(reps, p.profile)
      all.push({
        id: `demo-session-${patient.id}-${i + 1}`,
        patientId: patient.id,
        patientName: patient.name,
        exerciseId: plan.id,
        exerciseTitle: plan.title,
        completedAt: PHYSIO_DEMO_NOW - daysAgo * DAY_MS - Math.floor(rand() * 8) * 60 * 60 * 1000,
        durationSec: 240 + Math.floor(rand() * 480),
        targetMin: range.targetMin,
        targetMax: range.targetMax,
        reps,
      })
    })
  })
  return all.sort((a, b) => a.completedAt - b.completedAt)
}

export const PHYSIO_DEMO_SESSIONS: SessionRecord[] = buildSessions()
