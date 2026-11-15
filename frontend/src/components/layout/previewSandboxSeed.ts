import { PHYSIO_DEMO_PATIENTS, PHYSIO_DEMO_PLANS, PHYSIO_DEMO_PRESETS, PHYSIO_DEMO_SESSIONS } from '@/demo/physioDemoData'
import type { Exercise, PatientRecord, SessionRecord } from '@/types'
import { PREVIEW_PATIENT } from './devPreviewState'

/** Must match storageKeys('preview') in lib/data/AppDataContext.tsx. */
const KEYS = { exercises: 'smartphysio-preview:exercises', patients: 'smartphysio-preview:patients', sessions: 'smartphysio-preview:sessions' }

/** The test patient's history is copied from this on-track demo patient. */
const SOURCE_PATIENT = 'demo-patient-g'
const PREVIEW_PATIENT_ID = 'preview-patient'

/**
 * Fills the admin preview's sandbox with a full demo clinic: the labelled
 * demo patients A-L with their session history (the same data as the
 * /demo/physio pages), the presets, and the test patient with a Bicep Curl
 * plan and weeks of demo sessions. Called each time a preview starts, so
 * every preview opens on fresh, complete demo data. Writes only the preview's
 * own localStorage keys; real data is never touched.
 */
export function seedPreviewSandbox() {
  const sourcePlan = PHYSIO_DEMO_PLANS.find((p) => p.assignedPatientId === SOURCE_PATIENT)!
  const sourcePatient = PHYSIO_DEMO_PATIENTS.find((p) => p.id === SOURCE_PATIENT)!
  const plan: Exercise = { ...sourcePlan, id: `${sourcePlan.basedOnPresetId}--${PREVIEW_PATIENT_ID}`, assignedPatientId: PREVIEW_PATIENT_ID }
  const patient: PatientRecord = { ...sourcePatient, id: PREVIEW_PATIENT_ID, ...PREVIEW_PATIENT }
  const history: SessionRecord[] = PHYSIO_DEMO_SESSIONS.filter((s) => s.patientId === SOURCE_PATIENT).map((s) => ({
    ...s,
    id: s.id.replace(SOURCE_PATIENT, PREVIEW_PATIENT_ID),
    patientId: PREVIEW_PATIENT_ID,
    patientName: PREVIEW_PATIENT.name,
    exerciseId: plan.id,
    exerciseTitle: plan.title,
  }))
  try {
    window.localStorage.setItem(KEYS.exercises, JSON.stringify([...PHYSIO_DEMO_PRESETS, ...PHYSIO_DEMO_PLANS, plan]))
    window.localStorage.setItem(KEYS.patients, JSON.stringify([patient, ...PHYSIO_DEMO_PATIENTS]))
    window.localStorage.setItem(KEYS.sessions, JSON.stringify([...PHYSIO_DEMO_SESSIONS, ...history].sort((a, b) => a.completedAt - b.completedAt)))
  } catch {
    // Storage blocked: the preview still opens, with the seeding in DevPreview.tsx as a fallback.
  }
}
