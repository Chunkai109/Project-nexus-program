/**
 * Deterministic placeholder medical profile (height, weight, medical
 * history, prescribed medications) for a patient, derived purely from
 * their `id` -- nothing here is real clinical data, nothing is persisted,
 * and there is no intake form anywhere that collects it. Patients are
 * created automatically the first time they sign in (see
 * `registerPatientVisit` in AppDataContext.tsx) with just a name and
 * email; this exists only so the Patient Roster / Session Analytics
 * views have something plausible to show instead of an empty "no medical
 * info" state while this app has no real intake flow. Same `id` always
 * produces the same profile (stable across reloads/renders); different
 * patients get different-looking profiles. Every consumer of this must
 * label it as demo data -- see the "Demo data" badge in PatientRosterGrid
 * and TelemetrySection.
 */

import { hashSeed, mulberry32 } from './seededRandom'

export interface DummyMedicalProfile {
  heightCm: number
  weightKg: number
  medicalHistory: string[]
  prescribedMedications: string[]
}

// Orthopedic/rehab-relevant conditions, matching the kind of patient this
// app's exercises (bicep curl, knee ROM work) actually serve.
const MEDICAL_HISTORY_POOL = [
  'ACL reconstruction (left knee), 2022',
  'ACL reconstruction (right knee), 2021',
  'Partial rotator cuff tear, right shoulder',
  'Bicep tendon strain, right arm',
  'Meniscus repair (left knee), 2023',
  'Osteoarthritis — bilateral knees',
  'Chronic lower back strain',
  'Type 2 diabetes',
  'Hypertension',
  'Mild asthma',
  'Previous wrist fracture, left arm (healed)',
  'Tennis elbow (lateral epicondylitis)',
]

const MEDICATION_POOL = [
  'Ibuprofen 400mg PRN',
  'Naproxen 250mg BID',
  'Acetaminophen 500mg PRN',
  'Lisinopril 10mg QD',
  'Metformin 500mg BID',
  'Atorvastatin 20mg QD',
  'Vitamin D3 2000IU QD',
  'Omeprazole 20mg QD',
  'Cyclobenzaprine 5mg PRN (muscle spasm)',
]

/** Picks `count` distinct items from `pool`, in the PRNG's draw order. */
function pickDistinct<T>(pool: T[], count: number, rand: () => number): T[] {
  const remaining = [...pool]
  const picked: T[] = []
  for (let i = 0; i < count && remaining.length > 0; i++) {
    const idx = Math.floor(rand() * remaining.length)
    picked.push(remaining.splice(idx, 1)[0])
  }
  return picked
}

export function getDummyMedicalProfile(patientId: string): DummyMedicalProfile {
  const rand = mulberry32(hashSeed(patientId))

  const heightCm = Math.round(155 + rand() * 40) // 155-195cm
  const weightKg = Math.round(55 + rand() * 50) // 55-105kg
  const historyCount = 1 + Math.floor(rand() * 3) // 1-3 conditions
  const medicationCount = 1 + Math.floor(rand() * 2) // 1-2 medications

  return {
    heightCm,
    weightKg,
    medicalHistory: pickDistinct(MEDICAL_HISTORY_POOL, historyCount, rand),
    prescribedMedications: pickDistinct(MEDICATION_POOL, medicationCount, rand),
  }
}
