import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AngleConfig, Exercise, PatientRecord, PodId, SessionRecord } from '@/types'

/**
 * Shared app data (exercises physios create, real patients who've signed in,
 * completed session recordings), persisted to localStorage and synced live
 * across browser tabs via the `storage` event. This makes "physio creates an
 * exercise -> patient sees it -> patient completes it -> physio sees real
 * telemetry" genuinely work today without standing up a backend: open the
 * physio dashboard and the patient view in two tabs of the same browser and
 * changes propagate immediately. It does NOT sync across two different
 * browsers or devices — that needs a real backend + database, which this
 * intentionally stops short of since it means provisioning external
 * infrastructure.
 */

const EXERCISES_KEY = 'smartphysio:exercises'
const PATIENTS_KEY = 'smartphysio:patients'
const SESSIONS_KEY = 'smartphysio:sessions'

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJson<T>(key: string, value: T) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Private browsing / storage quota exceeded — state still works for this tab, just won't persist or cross-sync.
  }
}

/**
 * Exercises saved before angleConfigs/assignedPatientId existed are stored as
 * a flat nodeA/nodeB/targetRomMin/targetRomMax shape. Migrate those in place
 * on read so browsers with older SmartPhysio data don't crash on the new schema.
 */
function normalizeExercise(raw: Exercise & Partial<{ nodeA: PodId; nodeB: PodId; targetRomMin: number; targetRomMax: number }>): Exercise {
  const angleConfigs: AngleConfig[] =
    raw.angleConfigs ??
    (raw.nodeA && raw.nodeB
      ? [{ id: crypto.randomUUID(), nodeA: raw.nodeA, nodeB: raw.nodeB, targetMin: raw.targetRomMin ?? 90, targetMax: raw.targetRomMax ?? 110 }]
      : [])
  return { ...raw, angleConfigs, assignedPatientId: raw.assignedPatientId ?? null }
}

function loadExercises(): Exercise[] {
  return readJson<Exercise[]>(EXERCISES_KEY, []).map(normalizeExercise)
}

export type NewExercise = Omit<Exercise, 'id' | 'createdAt'>
export type NewSessionRecord = Omit<SessionRecord, 'id'>

interface AppDataValue {
  exercises: Exercise[]
  patients: PatientRecord[]
  sessions: SessionRecord[]
  addExercise: (input: NewExercise) => Exercise
  updateExercise: (id: string, patch: NewExercise) => void
  deleteExercise: (id: string) => void
  registerPatientVisit: (name: string, email: string) => void
  recordSession: (input: NewSessionRecord) => SessionRecord
}

const AppDataContext = createContext<AppDataValue | null>(null)

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [exercises, setExercises] = useState<Exercise[]>(() => loadExercises())
  const [patients, setPatients] = useState<PatientRecord[]>(() => readJson(PATIENTS_KEY, []))
  const [sessions, setSessions] = useState<SessionRecord[]>(() => readJson(SESSIONS_KEY, []))

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === EXERCISES_KEY) setExercises(loadExercises())
      if (e.key === PATIENTS_KEY) setPatients(readJson(PATIENTS_KEY, []))
      if (e.key === SESSIONS_KEY) setSessions(readJson(SESSIONS_KEY, []))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // Persisting is split into its own effect per collection, keyed off the
  // committed state, rather than called inline inside each setState updater.
  // Updater functions must stay pure — React (in StrictMode dev) invokes them
  // twice to check for that, and a side effect (or a fresh crypto.randomUUID())
  // inside one would fire twice with two different results, letting
  // localStorage and the real in-memory state drift apart.
  useEffect(() => writeJson(EXERCISES_KEY, exercises), [exercises])
  useEffect(() => writeJson(PATIENTS_KEY, patients), [patients])
  useEffect(() => writeJson(SESSIONS_KEY, sessions), [sessions])

  const addExercise = useCallback((input: NewExercise) => {
    const exercise: Exercise = { ...input, id: crypto.randomUUID(), createdAt: Date.now() }
    setExercises((prev) => [...prev, exercise])
    return exercise
  }, [])

  const updateExercise = useCallback((id: string, patch: NewExercise) => {
    setExercises((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)))
  }, [])

  const deleteExercise = useCallback((id: string) => {
    setExercises((prev) => prev.filter((e) => e.id !== id))
  }, [])

  const registerPatientVisit = useCallback((name: string, email: string) => {
    setPatients((prev) => {
      const now = Date.now()
      const existing = prev.find((p) => p.email === email)
      return existing
        ? prev.map((p) => (p.email === email ? { ...p, name, lastSeenAt: now } : p))
        : [...prev, { id: crypto.randomUUID(), name, email, firstSeenAt: now, lastSeenAt: now }]
    })
  }, [])

  const recordSession = useCallback((input: NewSessionRecord) => {
    const session: SessionRecord = { ...input, id: crypto.randomUUID() }
    setSessions((prev) => [...prev, session])
    return session
  }, [])

  const value = useMemo<AppDataValue>(
    () => ({
      exercises,
      patients,
      sessions,
      addExercise,
      updateExercise,
      deleteExercise,
      registerPatientVisit,
      recordSession,
    }),
    [exercises, patients, sessions, addExercise, updateExercise, deleteExercise, registerPatientVisit, recordSession],
  )

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
}

export function useAppData(): AppDataValue {
  const ctx = useContext(AppDataContext)
  if (!ctx) throw new Error('useAppData must be used within AppDataProvider')
  return ctx
}
