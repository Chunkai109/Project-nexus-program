import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Exercise, PatientRecord } from '@/types'

/**
 * Shared app data (exercises physios create, real patients who've signed in),
 * persisted to localStorage and synced live across browser tabs via the
 * `storage` event. This makes "physio creates an exercise -> patient sees it"
 * genuinely work today without standing up a backend: open the physio
 * dashboard and the patient view in two tabs of the same browser and changes
 * propagate immediately. It does NOT sync across two different browsers or
 * devices — that needs a real backend + database, which this intentionally
 * stops short of since it means provisioning external infrastructure.
 */

const EXERCISES_KEY = 'smartphysio:exercises'
const PATIENTS_KEY = 'smartphysio:patients'

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

export type NewExercise = Omit<Exercise, 'id' | 'createdAt'>

interface AppDataValue {
  exercises: Exercise[]
  patients: PatientRecord[]
  addExercise: (input: NewExercise) => Exercise
  updateExercise: (id: string, patch: NewExercise) => void
  deleteExercise: (id: string) => void
  registerPatientVisit: (name: string, email: string) => void
}

const AppDataContext = createContext<AppDataValue | null>(null)

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [exercises, setExercises] = useState<Exercise[]>(() => readJson(EXERCISES_KEY, []))
  const [patients, setPatients] = useState<PatientRecord[]>(() => readJson(PATIENTS_KEY, []))

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === EXERCISES_KEY) setExercises(readJson(EXERCISES_KEY, []))
      if (e.key === PATIENTS_KEY) setPatients(readJson(PATIENTS_KEY, []))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const addExercise = useCallback((input: NewExercise) => {
    const exercise: Exercise = { ...input, id: crypto.randomUUID(), createdAt: Date.now() }
    setExercises((prev) => {
      const next = [...prev, exercise]
      writeJson(EXERCISES_KEY, next)
      return next
    })
    return exercise
  }, [])

  const updateExercise = useCallback((id: string, patch: NewExercise) => {
    setExercises((prev) => {
      const next = prev.map((e) => (e.id === id ? { ...e, ...patch } : e))
      writeJson(EXERCISES_KEY, next)
      return next
    })
  }, [])

  const deleteExercise = useCallback((id: string) => {
    setExercises((prev) => {
      const next = prev.filter((e) => e.id !== id)
      writeJson(EXERCISES_KEY, next)
      return next
    })
  }, [])

  const registerPatientVisit = useCallback((name: string, email: string) => {
    setPatients((prev) => {
      const now = Date.now()
      const existing = prev.find((p) => p.email === email)
      const next = existing
        ? prev.map((p) => (p.email === email ? { ...p, name, lastSeenAt: now } : p))
        : [...prev, { id: crypto.randomUUID(), name, email, firstSeenAt: now, lastSeenAt: now }]
      writeJson(PATIENTS_KEY, next)
      return next
    })
  }, [])

  const value = useMemo<AppDataValue>(
    () => ({ exercises, patients, addExercise, updateExercise, deleteExercise, registerPatientVisit }),
    [exercises, patients, addExercise, updateExercise, deleteExercise, registerPatientVisit],
  )

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
}

export function useAppData(): AppDataValue {
  const ctx = useContext(AppDataContext)
  if (!ctx) throw new Error('useAppData must be used within AppDataProvider')
  return ctx
}
