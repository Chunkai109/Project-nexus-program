import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import type { AngleConfig, Exercise, MuscleEmgTarget, PatientRecord, PodId, SessionRecord } from '@/types'
import { supabase } from '@/lib/supabase/client'
import {
  exerciseFromRow,
  exercisePatchToRow,
  exerciseToRow,
  patientFromRow,
  sessionFromRow,
  sessionToRow,
  type ExerciseRow,
  type NewExercise,
  type NewSessionRecord,
  type PatientRow,
  type SessionRow,
} from '@/lib/supabase/rows'

/**
 * Shared app data (exercises physios create, real patients who've signed in,
 * completed session recordings). When Supabase is configured (see
 * src/lib/supabase/client.ts), this reads/writes a shared Postgres database
 * and syncs across tabs, browsers and devices in real time via Supabase
 * Realtime — that's what makes "patient completes a session on their phone,
 * physio sees it on their laptop" work. Without Supabase configured, it falls
 * back to localStorage + the `storage` event, which only syncs across tabs of
 * the same browser, so local/offline development still works unmodified.
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
 * a flat nodeA/nodeB/targetRomMin/targetRomMax(/faultThresholdDeg) shape,
 * exercises saved after that but before per-angle fault thresholds existed
 * have angleConfigs entries missing faultThresholdDeg, and exercises saved
 * before per-muscle EMG targets existed have a single flat targetEmgMvc
 * instead of muscleEmgTargets. Migrate all three in place on read so browsers
 * with older SmartPhysio localStorage data don't crash.
 */
type LegacyExerciseFields = Partial<{
  nodeA: PodId
  nodeB: PodId
  targetRomMin: number
  targetRomMax: number
  faultThresholdDeg: number
  targetEmgMvc: number
}>

function normalizeExercise(raw: Exercise & LegacyExerciseFields): Exercise {
  const { nodeA, nodeB, targetRomMin, targetRomMax, faultThresholdDeg: legacyFaultThresholdDeg, targetEmgMvc, ...rest } = raw
  const angleConfigs: AngleConfig[] = raw.angleConfigs
    ? raw.angleConfigs.map((c) => ({ ...c, faultThresholdDeg: c.faultThresholdDeg ?? legacyFaultThresholdDeg ?? 8 }))
    : nodeA && nodeB
      ? [
          {
            id: crypto.randomUUID(),
            nodeA,
            nodeB,
            targetMin: targetRomMin ?? 90,
            targetMax: targetRomMax ?? 110,
            faultThresholdDeg: legacyFaultThresholdDeg ?? 8,
          },
        ]
      : []
  const muscleEmgTargets: MuscleEmgTarget[] = raw.muscleEmgTargets
    ? raw.muscleEmgTargets
    : targetEmgMvc != null
      ? [
          { podId: 1, targetMvc: targetEmgMvc },
          { podId: 2, targetMvc: targetEmgMvc },
        ]
      : []
  return { ...rest, angleConfigs, muscleEmgTargets, assignedPatientId: raw.assignedPatientId ?? null }
}

function loadExercisesFromLocalStorage(): Exercise[] {
  return readJson<Exercise[]>(EXERCISES_KEY, []).map(normalizeExercise)
}

export type { NewExercise, NewSessionRecord }

interface AppDataValue {
  exercises: Exercise[]
  patients: PatientRecord[]
  sessions: SessionRecord[]
  /** True until the initial Supabase fetch resolves. Always false when Supabase isn't configured. */
  loading: boolean
  addExercise: (input: NewExercise) => Exercise
  updateExercise: (id: string, patch: NewExercise) => void
  deleteExercise: (id: string) => void
  registerPatientVisit: (name: string, email: string) => void
  recordSession: (input: NewSessionRecord) => SessionRecord
}

const AppDataContext = createContext<AppDataValue | null>(null)

/** Upserts (INSERT/UPDATE) or removes (DELETE) one row's mapped item into local state by id, so a client's own optimistic write and the realtime echo of it converge instead of duplicating. */
function applyRealtimeChange<TRow extends { id: string }, T extends { id: string }>(
  setState: (updater: (prev: T[]) => T[]) => void,
  payload: RealtimePostgresChangesPayload<TRow>,
  fromRow: (row: TRow) => T,
) {
  if (payload.eventType === 'DELETE') {
    const oldId = (payload.old as Partial<TRow>).id
    if (!oldId) return
    setState((prev) => prev.filter((item) => item.id !== oldId))
    return
  }
  const item = fromRow(payload.new as TRow)
  setState((prev) => {
    const idx = prev.findIndex((existing) => existing.id === item.id)
    if (idx === -1) return [...prev, item]
    const next = [...prev]
    next[idx] = item
    return next
  })
}

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [exercises, setExercises] = useState<Exercise[]>(() => (supabase ? [] : loadExercisesFromLocalStorage()))
  const [patients, setPatients] = useState<PatientRecord[]>(() => (supabase ? [] : readJson(PATIENTS_KEY, [])))
  const [sessions, setSessions] = useState<SessionRecord[]>(() => (supabase ? [] : readJson(SESSIONS_KEY, [])))
  const [loading, setLoading] = useState(() => Boolean(supabase))
  const patientsRef = useRef<PatientRecord[]>(patients)
  useEffect(() => {
    patientsRef.current = patients
  }, [patients])

  // --- Supabase mode: initial fetch + realtime subscriptions ---
  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    Promise.all([
      supabase.from('exercises').select('*').order('created_at', { ascending: true }),
      supabase.from('patients').select('*').order('first_seen_at', { ascending: true }),
      supabase.from('sessions').select('*').order('completed_at', { ascending: true }),
    ]).then(([exercisesRes, patientsRes, sessionsRes]) => {
      if (cancelled) return
      if (exercisesRes.error) console.error('Failed to load exercises from Supabase', exercisesRes.error)
      else setExercises((exercisesRes.data as ExerciseRow[]).map(exerciseFromRow))
      if (patientsRes.error) console.error('Failed to load patients from Supabase', patientsRes.error)
      else setPatients((patientsRes.data as PatientRow[]).map(patientFromRow))
      if (sessionsRes.error) console.error('Failed to load sessions from Supabase', sessionsRes.error)
      else setSessions((sessionsRes.data as SessionRow[]).map(sessionFromRow))
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const client = supabase
    if (!client) return
    const channel = client
      .channel('smartphysio-sync')
      .on<ExerciseRow>('postgres_changes', { event: '*', schema: 'public', table: 'exercises' }, (payload) =>
        applyRealtimeChange(setExercises, payload, exerciseFromRow),
      )
      .on<PatientRow>('postgres_changes', { event: '*', schema: 'public', table: 'patients' }, (payload) =>
        applyRealtimeChange(setPatients, payload, patientFromRow),
      )
      .on<SessionRow>('postgres_changes', { event: '*', schema: 'public', table: 'sessions' }, (payload) =>
        applyRealtimeChange(setSessions, payload, sessionFromRow),
      )
      .subscribe()
    return () => {
      client.removeChannel(channel)
    }
  }, [])

  // --- localStorage mode: cross-tab sync only (used when Supabase isn't configured) ---
  useEffect(() => {
    if (supabase) return
    function onStorage(e: StorageEvent) {
      if (e.key === EXERCISES_KEY) setExercises(loadExercisesFromLocalStorage())
      if (e.key === PATIENTS_KEY) setPatients(readJson(PATIENTS_KEY, []))
      if (e.key === SESSIONS_KEY) setSessions(readJson(SESSIONS_KEY, []))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // Persisting to localStorage is split into its own effect per collection,
  // keyed off committed state, rather than called inline inside each setState
  // updater. Updater functions must stay pure — React (in StrictMode dev)
  // invokes them twice to check for that, and a side effect inside one would
  // fire twice with two different results, letting localStorage and the real
  // in-memory state drift apart. Skipped entirely once Supabase is configured.
  useEffect(() => {
    if (!supabase) writeJson(EXERCISES_KEY, exercises)
  }, [exercises])
  useEffect(() => {
    if (!supabase) writeJson(PATIENTS_KEY, patients)
  }, [patients])
  useEffect(() => {
    if (!supabase) writeJson(SESSIONS_KEY, sessions)
  }, [sessions])

  const addExercise = useCallback((input: NewExercise) => {
    const exercise: Exercise = { ...input, id: crypto.randomUUID(), createdAt: Date.now() }
    setExercises((prev) => [...prev, exercise])
    if (supabase) {
      supabase
        .from('exercises')
        .insert(exerciseToRow(exercise))
        .then(({ error }) => {
          if (error) console.error('Failed to save exercise to Supabase', error)
        })
    }
    return exercise
  }, [])

  const updateExercise = useCallback((id: string, patch: NewExercise) => {
    setExercises((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)))
    if (supabase) {
      supabase
        .from('exercises')
        .update(exercisePatchToRow(patch))
        .eq('id', id)
        .then(({ error }) => {
          if (error) console.error('Failed to update exercise in Supabase', error)
        })
    }
  }, [])

  const deleteExercise = useCallback((id: string) => {
    setExercises((prev) => prev.filter((e) => e.id !== id))
    if (supabase) {
      supabase
        .from('exercises')
        .delete()
        .eq('id', id)
        .then(({ error }) => {
          if (error) console.error('Failed to delete exercise in Supabase', error)
        })
    }
  }, [])

  const registerPatientVisit = useCallback((name: string, email: string) => {
    const now = Date.now()
    const existing = patientsRef.current.find((p) => p.email === email)
    const optimistic: PatientRecord = existing
      ? { ...existing, name, lastSeenAt: now }
      : { id: crypto.randomUUID(), name, email, firstSeenAt: now, lastSeenAt: now }
    setPatients((prev) => {
      const idx = prev.findIndex((p) => p.email === email)
      if (idx === -1) return [...prev, optimistic]
      const next = [...prev]
      next[idx] = optimistic
      return next
    })
    if (!supabase) return
    // Upsert on email (not id): two devices registering the same new patient
    // for the first time at once should converge on one row, not collide.
    supabase
      .from('patients')
      .upsert(
        {
          name,
          email,
          first_seen_at: new Date(optimistic.firstSeenAt).toISOString(),
          last_seen_at: new Date(now).toISOString(),
        },
        { onConflict: 'email' },
      )
      .select()
      .single()
      .then(({ data, error }) => {
        if (error) {
          console.error('Failed to sync patient to Supabase', error)
          return
        }
        const canonical = patientFromRow(data as PatientRow)
        setPatients((prev) => {
          const idx = prev.findIndex((p) => p.email === email)
          if (idx === -1) return [...prev, canonical]
          const next = [...prev]
          next[idx] = canonical
          return next
        })
      })
  }, [])

  const recordSession = useCallback((input: NewSessionRecord) => {
    const session: SessionRecord = { ...input, id: crypto.randomUUID() }
    setSessions((prev) => [...prev, session])
    if (supabase) {
      supabase
        .from('sessions')
        .insert(sessionToRow(session))
        .then(({ error }) => {
          if (error) console.error('Failed to save session to Supabase', error)
        })
    }
    return session
  }, [])

  const value = useMemo<AppDataValue>(
    () => ({
      exercises,
      patients,
      sessions,
      loading,
      addExercise,
      updateExercise,
      deleteExercise,
      registerPatientVisit,
      recordSession,
    }),
    [exercises, patients, sessions, loading, addExercise, updateExercise, deleteExercise, registerPatientVisit, recordSession],
  )

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
}

export function useAppData(): AppDataValue {
  const ctx = useContext(AppDataContext)
  if (!ctx) throw new Error('useAppData must be used within AppDataProvider')
  return ctx
}
