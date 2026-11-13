/**
 * DEMO DATA for the patient-portal preview at /demo/patient.
 *
 * Nothing here is a real patient, a real exercise plan or a real session.
 * It exists so the five patient screens can be shown without the rig. It is
 * generated from a fixed seed, so it looks the same on every load, and it is
 * never written to the app's storage or sent anywhere.
 *
 * Shapes match the real app (see lib/dummySessionHistory.ts and
 * lib/mockData.ts). checkDemoData.ts verifies that the totals add up.
 */
import { hashSeed, mulberry32 } from '@/lib/seededRandom'
import { PODS } from '@/lib/mockData'
import { VISION_PREDICTION_CLASSES } from '@/lib/visionModel'
import type { Exercise, RepSample, SessionRecord } from '@/types'
import type { PodRow } from '@/components/patient/SensorSetupView'

const DAY_MS = 24 * 60 * 60 * 1000
const PROGRAMME_DAYS = 42 // a 6-week programme
/** The full elbow range on the rig. */
const ANGLE_MAX = 135

export const DEMO_PATIENT = { id: 'demo-patient', name: 'Demo Patient' }

function demoExercise(
  id: string,
  title: string,
  sets: number,
  reps: number,
  estMinutes: number,
  targetMin: number,
  targetMax: number,
  driftToleranceDeg: number,
  therapistNote: string,
  setupInstructions: string,
): Exercise {
  const createdAt = Date.now() - PROGRAMME_DAYS * DAY_MS
  return {
    id,
    title,
    muscleGroups: ['Arm'],
    sets,
    reps,
    muscleEmgTargets: [],
    therapistNote,
    setupInstructions,
    estMinutes,
    angleConfigs: [{ id: `${id}-angle`, nodeA: 2, nodeB: 3, targetMin, targetMax, faultThresholdDeg: 15 }],
    assignedPatientId: DEMO_PATIENT.id,
    basedOnPresetId: null,
    driftToleranceDeg,
    bodyRegion: 'upper',
    createdAt,
    updatedAt: createdAt,
    presetSnapshotAt: null,
  }
}

export const DEMO_EXERCISES: Exercise[] = [
  demoExercise(
    'demo-bicep-curl',
    'Bicep Curl',
    3,
    10,
    8,
    100,
    125,
    18,
    'Slow and steady. Keep your elbow tucked in at your side and stop if it hurts.',
    'Sit or stand side-on to the camera, about 2 m away, so your whole arm is in view. Use the 1 kg dumbbell.',
  ),
  demoExercise(
    'demo-slow-lowering-curl',
    'Slow-Lowering Curl',
    3,
    8,
    10,
    100,
    135,
    22,
    'Curl up normally, then count to three as you lower. Rest for a minute between sets.',
    'Same setup as the Bicep Curl.',
  ),
  demoExercise('demo-light-curl', 'Light Warm-Up Curl', 2, 12, 5, 90, 120, 22, 'No weight for this one. Just get the arm moving.', ''),
]

/** Sensor setup: one pod with a weak signal and low battery, to show those states. */
export const DEMO_POD_ROWS: PodRow[] = [
  { pod: PODS[0], name: 'Muscle sensor', place: 'On the bicep', signal: 'strong', battery: 94 },
  { pod: PODS[1], name: 'Motion sensor', place: 'On the outer forearm', signal: 'strong', battery: 91 },
  { pod: PODS[2], name: 'Motion sensor', place: 'Back of the upper arm, just above the elbow', signal: 'weak', battery: 17 },
  { pod: PODS[3], name: 'Vibration motor', place: 'On the bicep', signal: 'strong', battery: null, poweredByHub: true },
]

const FAULT_CLASSES = VISION_PREDICTION_CLASSES.filter((c) => c !== 'Perfect')

/** One demo session. `progress` runs 0 (start of the programme) to 1 (today): form gets better over time. */
function demoSession(index: number, exercise: Exercise, completedAt: number, progress: number): SessionRecord {
  const rand = mulberry32(hashSeed(`smartphysio-demo-session-${index}`))
  const { targetMin, targetMax } = exercise.angleConfigs[0]
  const planned = exercise.sets * exercise.reps
  // 10 to 36 reps: usually the plan, sometimes cut short.
  const totalReps = Math.max(10, Math.min(36, rand() < 0.75 ? planned : planned - 2 - Math.floor(rand() * 8)))
  const pInRange = 0.68 + 0.27 * progress
  const pDrift = 0.16 - 0.12 * progress
  const pScored = 0.62 + 0.18 * progress // the camera misses a good share of reps
  const pPerfect = 0.45 + 0.4 * progress

  const reps: RepSample[] = []
  for (let i = 0; i < totalReps; i++) {
    const inRange = rand() < pInRange
    const raw = inRange ? targetMin + rand() * (targetMax - targetMin) : targetMin - 4 - rand() * 22
    const angle = Math.round(Math.max(0, Math.min(ANGLE_MAX, raw)))
    const emg = Math.round(Math.max(0, Math.min(100, (angle / ANGLE_MAX) * 80 + rand() * 10)))
    const rep: RepSample = { rep: i + 1, angle, emgLeft: emg, emgRight: emg, faultActive: rand() < pDrift }
    if (rand() < pScored) {
      const perfect = rand() < pPerfect
      const verdict = perfect ? 'Perfect' : FAULT_CLASSES[Math.floor(rand() * FAULT_CLASSES.length)]
      const score = perfect ? 80 + Math.floor(rand() * 18) : 22 + Math.floor(rand() * 35)
      // Same format the live session saves, with no coaching sentence: the demo doesn't invent advice.
      rep.aiComment = `${verdict} (${score}% good form)`
    }
    reps.push(rep)
  }
  return {
    id: `demo-session-${index}`,
    patientId: DEMO_PATIENT.id,
    patientName: DEMO_PATIENT.name,
    exerciseId: exercise.id,
    exerciseTitle: exercise.title,
    completedAt,
    durationSec: Math.round(Math.max(240, Math.min(720, totalReps * (13 + rand() * 6)))), // 4 to 12 minutes
    targetMin,
    targetMax,
    reps,
  }
}

/**
 * About one session a day over six weeks (two rest days), oldest first. The
 * last one is "today" and uses the first exercise, so the exercise list shows
 * one exercise done and two still to do.
 */
export function buildDemoSessions(now = Date.now()): SessionRecord[] {
  const today = new Date(now)
  today.setHours(9, 14, 0, 0)
  const sessions: SessionRecord[] = []
  for (let daysAgo = PROGRAMME_DAYS - 1; daysAgo >= 0; daysAgo--) {
    if (daysAgo === 30 || daysAgo === 16) continue // missed days
    const index = PROGRAMME_DAYS - 1 - daysAgo
    const exercise = daysAgo === 0 || index % 4 !== 3 ? DEMO_EXERCISES[0] : DEMO_EXERCISES[1]
    sessions.push(demoSession(index, exercise, today.getTime() - daysAgo * DAY_MS, 1 - daysAgo / (PROGRAMME_DAYS - 1)))
  }
  return sessions
}

/**
 * The scripted live session: what the camera AI "says" for each rep, in order.
 * null = the camera missed the rep. Rep 4 also has an upper-arm drift fault.
 */
export const DEMO_LIVE_VERDICTS: (string | null)[] = [
  'Perfect', 'Perfect', null, 'Swing', 'Perfect', 'Perfect', 'Half', 'Perfect', null, 'Perfect',
  'Perfect', 'Perfect', 'Perfect', null, 'Drag', 'Perfect', 'Perfect', 'Perfect', 'Perfect', 'Perfect',
  'Perfect', null, 'Perfect', 'Perfect', 'Perfect', 'Perfect', 'Heave', 'Perfect', 'Perfect', 'Perfect',
]
export const DEMO_LIVE_DRIFT_REP = 4
