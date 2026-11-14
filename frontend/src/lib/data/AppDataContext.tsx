import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { PostgrestError, RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import type { AngleConfig, Exercise, PatientRecord, PodId, SessionRecord } from '@/types'
import { supabase } from '@/lib/supabase/client'
import { useAuth } from '@/lib/AuthContext'
import { normalizeMuscleEmgTargets, type LegacyMuscleEmgTarget } from '@/lib/muscles'
import { isBodyRegion, suggestBodyRegion } from '@/lib/bodyRegion'
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

export const DEFAULT_DRIFT_TOLERANCE_DEG = 22

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
 * Sessions that couldn't be uploaded yet, per account. The laptop is on the
 * ESP32 hub's WiFi (no internet) during a live session, so the upload at
 * "End Session" often fails; the row waits here until the internet is back.
 */
function pendingSessionsKey(userId: string) {
  return `smartphysio:pending-sessions:${userId}`
}

function readPendingSessions(userId: string): SessionRow[] {
  return readJson<SessionRow[]>(pendingSessionsKey(userId), [])
}

function queuePendingSession(row: SessionRow) {
  const pending = readPendingSessions(row.patient_id)
  if (!pending.some((r) => r.id === row.id)) writeJson(pendingSessionsKey(row.patient_id), [...pending, row])
}

/** Postgres/PostgREST errors carry a code: the server answered and refused, so retrying won't help. Network failures have no code. */
function isServerRefusal(error: PostgrestError): boolean {
  return Boolean(error.code)
}

/** 23505 = unique violation: an earlier attempt already saved this session (only its response was lost). */
function isAlreadySaved(error: PostgrestError): boolean {
  return error.code === '23505'
}

/**
 * Exercises saved before angleConfigs/assignedPatientId existed are stored as
 * a flat nodeA/nodeB/targetRomMin/targetRomMax(/faultThresholdDeg) shape,
 * exercises saved after that but before per-angle fault thresholds existed
 * have angleConfigs entries missing faultThresholdDeg, and exercises saved
 * before per-muscle EMG targets existed have either a single flat
 * targetEmgMvc or a legacy muscleEmgTargets shape (see normalizeMuscleEmgTargets
 * in lib/muscles.ts). Migrate all of these in place on read so browsers with
 * older SmartPhysio localStorage data don't crash.
 */
type LegacyExerciseFields = Partial<{
  nodeA: PodId
  nodeB: PodId
  targetRomMin: number
  targetRomMax: number
  faultThresholdDeg: number
  targetEmgMvc: number
}>

type StoredExercise = Omit<Exercise, 'muscleEmgTargets' | 'basedOnPresetId' | 'driftToleranceDeg' | 'updatedAt' | 'presetSnapshotAt' | 'bodyRegion'> &
  Partial<Pick<Exercise, 'basedOnPresetId' | 'driftToleranceDeg' | 'updatedAt' | 'presetSnapshotAt' | 'bodyRegion'>> &
  LegacyExerciseFields & { muscleEmgTargets?: LegacyMuscleEmgTarget[] }

function normalizeExercise(raw: StoredExercise): Exercise {
  const { nodeA, nodeB, targetRomMin, targetRomMax, faultThresholdDeg: legacyFaultThresholdDeg, targetEmgMvc, muscleEmgTargets: rawMuscleEmgTargets, ...rest } = raw
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
  const muscleEmgTargets = normalizeMuscleEmgTargets(rawMuscleEmgTargets, targetEmgMvc)
  return {
    ...rest,
    angleConfigs,
    muscleEmgTargets,
    // Exercises saved before per-patient plans: an assigned one becomes that patient's own plan.
    assignedPatientId: raw.assignedPatientId ?? null,
    basedOnPresetId: raw.basedOnPresetId ?? null,
    driftToleranceDeg: raw.driftToleranceDeg ?? DEFAULT_DRIFT_TOLERANCE_DEG,
    // Saved before body regions existed: use the one suggested by its muscle groups.
    bodyRegion: isBodyRegion(raw.bodyRegion) ? raw.bodyRegion : suggestBodyRegion(raw.muscleGroups ?? []),
    updatedAt: raw.updatedAt ?? raw.createdAt,
    presetSnapshotAt: raw.presetSnapshotAt ?? null,
  }
}

function loadExercisesFromLocalStorage(key: string = EXERCISES_KEY): Exercise[] {
  return readJson<StoredExercise[]>(key, []).map(normalizeExercise)
}

/** Storage keys for the normal local mode, or a separate set for a developer preview sandbox. */
function storageKeys(sandbox?: string) {
  if (!sandbox) return { exercises: EXERCISES_KEY, patients: PATIENTS_KEY, sessions: SESSIONS_KEY }
  return { exercises: `smartphysio-${sandbox}:exercises`, patients: `smartphysio-${sandbox}:patients`, sessions: `smartphysio-${sandbox}:sessions` }
}

/**
 * Seeded automatically whenever there are no exercises at all, so a fresh
 * install (or an emptied exercise list) always has something to test the
 * ESP32 hub against instead of starting on an empty "no exercises yet"
 * screen. Angle config targets pods 2/3 — the forearm and upper-arm IMUs
 * (CURL_FLEX_POD_ID/CURL_DRIFT_POD_ID in bicepCurlCounter.ts) that actually
 * drive the real hub rep counter; Pod 1 is EMG-only on this rig (see
 * EMG_PODS in CalibrationPage.tsx), not a second angle node.
 *
 * The 100°-135° corridor is a measured value, not a guess: a real curl on
 * this rig reads 0° at full extension and 135° at full contraction (an
 * earlier 150°-180° default was never actually measured against the real
 * sensor and doesn't fit inside its real 0-135 range at all -- it could
 * never be reached). This corridor is the "good, deep contraction" zone
 * that triggers the dashboard's 1-second haptic pulse on the corridor motor
 * (Pod 15, see LiveSession.tsx) -- separate from and deliberately not tied
 * to bicepCurlCounter.ts's own rep-counting thresholds, which span more of
 * the full 0-135 range so an ordinary rep still gets counted even short of
 * this corridor.
 */
function buildDefaultBicepCurlExercise(): NewExercise {
  return {
    title: 'Bicep Curl',
    muscleGroups: ['Arm'],
    sets: 3,
    reps: 10,
    muscleEmgTargets: [],
    therapistNote: '',
    setupInstructions: '',
    estMinutes: 5,
    angleConfigs: [{ id: crypto.randomUUID(), nodeA: 2, nodeB: 3, targetMin: 100, targetMax: 135, faultThresholdDeg: 15 }],
    assignedPatientId: null,
    driftToleranceDeg: DEFAULT_DRIFT_TOLERANCE_DEG,
    bodyRegion: 'upper',
  }
}

/**
 * Dummy protocols seeded alongside the Bicep Curl default so the Exercise
 * Creator list (and downstream screens like Session Analytics) has more
 * than one exercise to demo against. Angle configs use the same left/right
 * node pairs the Angle Configuration step's Joint Picker offers for these
 * joints (see JOINT_PRESETS in lib/joints.ts), tracking both limbs since
 * these are bilateral, symmetric movements — unlike the single-motor Bicep
 * Curl rig this app was originally built against.
 */
function buildDefaultSquatsExercise(): NewExercise {
  return {
    title: 'Squats',
    muscleGroups: ['Upper Leg', 'Lower Leg'],
    sets: 3,
    reps: 15,
    muscleEmgTargets: [],
    therapistNote: 'Keep weight in the heels and knees tracking over the toes.',
    setupInstructions: '',
    estMinutes: 8,
    angleConfigs: [
      { id: crypto.randomUUID(), nodeA: 1, nodeB: 3, targetMin: 90, targetMax: 110, faultThresholdDeg: 15 },
      { id: crypto.randomUUID(), nodeA: 2, nodeB: 4, targetMin: 90, targetMax: 110, faultThresholdDeg: 15 },
    ],
    assignedPatientId: null,
    driftToleranceDeg: DEFAULT_DRIFT_TOLERANCE_DEG,
    bodyRegion: 'lower',
  }
}

function buildDefaultPushUpExercise(): NewExercise {
  return {
    title: 'Push Up',
    muscleGroups: ['Chest', 'Arm'],
    sets: 3,
    reps: 12,
    muscleEmgTargets: [],
    therapistNote: 'Keep a straight line from shoulders to ankles throughout the movement.',
    setupInstructions: '',
    estMinutes: 6,
    angleConfigs: [
      { id: crypto.randomUUID(), nodeA: 9, nodeB: 11, targetMin: 20, targetMax: 145, faultThresholdDeg: 15 },
      { id: crypto.randomUUID(), nodeA: 10, nodeB: 12, targetMin: 20, targetMax: 145, faultThresholdDeg: 15 },
    ],
    assignedPatientId: null,
    driftToleranceDeg: DEFAULT_DRIFT_TOLERANCE_DEG,
    bodyRegion: 'upper',
  }
}

function buildDefaultShoulderPressExercise(): NewExercise {
  return {
    title: 'Shoulder Press',
    muscleGroups: ['Shoulder', 'Arm'],
    sets: 3,
    reps: 10,
    muscleEmgTargets: [],
    therapistNote: 'Press straight overhead without arching the lower back.',
    setupInstructions: '',
    estMinutes: 7,
    angleConfigs: [
      { id: crypto.randomUUID(), nodeA: 7, nodeB: 9, targetMin: 30, targetMax: 150, faultThresholdDeg: 15 },
      { id: crypto.randomUUID(), nodeA: 8, nodeB: 10, targetMin: 30, targetMax: 150, faultThresholdDeg: 15 },
    ],
    assignedPatientId: null,
    driftToleranceDeg: DEFAULT_DRIFT_TOLERANCE_DEG,
    bodyRegion: 'upper',
  }
}

export type { NewExercise, NewSessionRecord }

interface AppDataValue {
  exercises: Exercise[]
  patients: PatientRecord[]
  sessions: SessionRecord[]
  /** True until the initial Supabase fetch resolves. Always false when Supabase isn't configured. */
  loading: boolean
  addExercise: (input: NewExercise) => Exercise
  /** Copies a preset into a new plan for one patient. Resolves once saved; rejects if the save failed (nothing is added then). */
  createPlanFromPreset: (presetId: string, patientId: string, fields: NewExercise) => Promise<Exercise>
  /** Resolves once saved; rejects if the save failed (local state is left unchanged then). */
  updateExercise: (id: string, patch: NewExercise) => Promise<void>
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

function makeAppDataProvider(db: typeof supabase, keys: ReturnType<typeof storageKeys>) {
  return function AppDataProviderFor({ children }: { children: ReactNode }) {
    const [exercises, setExercises] = useState<Exercise[]>(() => (db ? [] : loadExercisesFromLocalStorage(keys.exercises)))
    const [patients, setPatients] = useState<PatientRecord[]>(() => (db ? [] : readJson(keys.patients, [])))
    const [sessions, setSessions] = useState<SessionRecord[]>(() => (db ? [] : readJson(keys.sessions, [])))
    const { user } = useAuth()
    const userId = db ? (user?.id ?? null) : null
    // An admin works in one clinic at a time. The database lets an admin read every account,
    // so the patient list is narrowed here to the clinic the admin has open.
    const adminClinic = user?.role === 'admin' ? user.practiceId : null
    // Which account's data has finished loading; loading is derived from it.
    const [loadedFor, setLoadedFor] = useState<string | null>(null)
    const loading = userId !== null && loadedFor !== userId
    const patientsRef = useRef<PatientRecord[]>(patients)
    useEffect(() => {
      patientsRef.current = patients
    }, [patients])

    // --- Supabase mode: fetch + realtime, per signed-in account ---
    // Keyed on the signed-in user: the database's access rules only return
    // rows that account may see, so data is reloaded whenever a different
    // person signs in, and cleared on sign-out.
    useEffect(() => {
      if (!db || !userId) return
      let cancelled = false
      Promise.all([
        db.from('exercises').select('*').order('created_at', { ascending: true }),
        (adminClinic
          ? db.from('profiles').select('id, name, email, first_seen_at, last_seen_at').eq('role', 'patient').eq('practice_id', adminClinic)
          : db.from('profiles').select('id, name, email, first_seen_at, last_seen_at').eq('role', 'patient')
        ).order('first_seen_at', { ascending: true }),
        db.from('sessions').select('*').order('completed_at', { ascending: true }),
      ]).then(([exercisesRes, patientsRes, sessionsRes]) => {
        if (cancelled) return
        if (exercisesRes.error) console.error('Failed to load exercises from Supabase', exercisesRes.error)
        else setExercises((exercisesRes.data as ExerciseRow[]).map(exerciseFromRow))
        if (patientsRes.error) console.error('Failed to load patients from Supabase', patientsRes.error)
        else setPatients((patientsRes.data as PatientRow[]).map(patientFromRow))
        if (sessionsRes.error) console.error('Failed to load sessions from Supabase', sessionsRes.error)
        else {
          // Sessions still waiting to upload stay visible to the patient who recorded them.
          const saved = (sessionsRes.data as SessionRow[]).map(sessionFromRow)
          const savedIds = new Set(saved.map((sv) => sv.id))
          const pending = readPendingSessions(userId).filter((r) => !savedIds.has(r.id)).map(sessionFromRow)
          setSessions([...saved, ...pending].sort((a, b) => a.completedAt - b.completedAt))
        }
        setLoadedFor(userId)
      })
      return () => {
        // Runs on sign-out or account switch: drop the previous account's data.
        cancelled = true
        setExercises([])
        setPatients([])
        setSessions([])
        setLoadedFor(null)
      }
    }, [userId, adminClinic])

    useEffect(() => {
      const client = db
      if (!client || !userId) return
      const channel = client
        .channel(`smartphysio-sync-${userId}`)
        .on<ExerciseRow>('postgres_changes', { event: '*', schema: 'public', table: 'exercises' }, (payload) =>
          applyRealtimeChange(setExercises, payload, exerciseFromRow),
        )
        .on<PatientRow>(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'profiles', filter: 'role=eq.patient' },
          (payload) => applyRealtimeChange(setPatients, payload, patientFromRow),
        )
        .on<SessionRow>('postgres_changes', { event: '*', schema: 'public', table: 'sessions' }, (payload) =>
          applyRealtimeChange(setSessions, payload, sessionFromRow),
        )
        .subscribe()
      return () => {
        client.removeChannel(channel)
      }
    }, [userId])

    // Retry uploading queued sessions: right after sign-in, whenever the
    // browser reports it's back online, and every 20s as a fallback.
    useEffect(() => {
      if (!db || !userId) return
      const client = db
      const uid = userId
      let flushing = false
      async function flush() {
        if (flushing) return
        const pending = readPendingSessions(uid)
        if (pending.length === 0) return
        flushing = true
        const done = new Set<string>()
        for (const row of pending) {
          const { error } = await client.from('sessions').insert(row)
          if (!error || isAlreadySaved(error)) {
            done.add(row.id)
          } else if (isServerRefusal(error)) {
            console.error('Server refused a queued session; dropping it', error, row)
            done.add(row.id)
          } else {
            break // still offline: keep the rest for the next try
          }
        }
        // Re-read so sessions queued while this was running aren't lost.
        writeJson(pendingSessionsKey(uid), readPendingSessions(uid).filter((r) => !done.has(r.id)))
        flushing = false
      }
      flush()
      window.addEventListener('online', flush)
      const timer = window.setInterval(flush, 20_000)
      return () => {
        window.removeEventListener('online', flush)
        window.clearInterval(timer)
      }
    }, [userId])

    // --- localStorage mode: cross-tab sync only (used when Supabase isn't configured) ---
    useEffect(() => {
      if (db) return
      function onStorage(e: StorageEvent) {
        if (e.key === keys.exercises) setExercises(loadExercisesFromLocalStorage(keys.exercises))
        if (e.key === keys.patients) setPatients(readJson(keys.patients, []))
        if (e.key === keys.sessions) setSessions(readJson(keys.sessions, []))
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
      if (!db) writeJson(keys.exercises, exercises)
    }, [exercises])
    useEffect(() => {
      if (!db) writeJson(keys.patients, patients)
    }, [patients])
    useEffect(() => {
      if (!db) writeJson(keys.sessions, sessions)
    }, [sessions])

    const exercisesRef = useRef<Exercise[]>(exercises)
    useEffect(() => {
      exercisesRef.current = exercises
    }, [exercises])

    const addExercise = useCallback((input: NewExercise) => {
      const now = Date.now()
      const exercise: Exercise = {
        ...input,
        id: crypto.randomUUID(),
        basedOnPresetId: null,
        createdAt: now,
        updatedAt: now,
        presetSnapshotAt: null,
      }
      setExercises((prev) => [...prev, exercise])
      if (db) {
        db
          .from('exercises')
          .insert(exerciseToRow(exercise))
          .then(({ error }) => {
            if (error) console.error('Failed to save exercise to Supabase', error)
          })
      }
      return exercise
    }, [])

    // Seed the default Bicep Curl exercise the moment the exercise list is
    // confirmed empty — after the initial Supabase fetch resolves (or
    // immediately in localStorage mode, which never has a loading phase).
    // Guarded by a ref rather than relying on exercises.length alone so a
    // slow network response landing after this already fired can't cause a
    // duplicate.
    const seededDefaultRef = useRef(false)
    useEffect(() => {
      // With Supabase, starter exercises are created by supabase/schema.sql per practice.
      if (db || seededDefaultRef.current || loading || exercises.length > 0) return
      seededDefaultRef.current = true
      for (const build of [
        buildDefaultBicepCurlExercise,
        buildDefaultSquatsExercise,
        buildDefaultPushUpExercise,
        buildDefaultShoulderPressExercise,
      ]) {
        addExercise(build())
      }
    }, [loading, exercises.length, addExercise])

    const createPlanFromPreset = useCallback(async (presetId: string, patientId: string, fields: NewExercise) => {
      const preset = exercisesRef.current.find((e) => e.id === presetId)
      if (!preset) throw new Error('Preset not found')
      const now = Date.now()
      const plan: Exercise = {
        ...fields,
        id: crypto.randomUUID(),
        assignedPatientId: patientId,
        basedOnPresetId: presetId,
        presetSnapshotAt: preset.updatedAt,
        createdAt: now,
        updatedAt: now,
      }
      if (db) {
        const { error } = await db.from('exercises').insert(exerciseToRow(plan))
        if (error) {
          console.error('Failed to save patient plan to Supabase', error)
          throw error
        }
      }
      // Added after the save so a failed save never shows a plan that isn't stored.
      // The realtime echo of the insert converges by id, so this can't duplicate.
      setExercises((prev) => (prev.some((e) => e.id === plan.id) ? prev : [...prev, plan]))
      return plan
    }, [])

    const updateExercise = useCallback(async (id: string, patch: NewExercise) => {
      const updatedAt = Date.now()
      if (db) {
        const { error } = await db.from('exercises').update(exercisePatchToRow(patch, updatedAt)).eq('id', id)
        if (error) {
          console.error('Failed to update exercise in Supabase', error)
          throw error
        }
      }
      setExercises((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch, updatedAt } : e)))
    }, [])

    const deleteExercise = useCallback((id: string) => {
      // Plans copied from a deleted preset keep working as their own plan (the database does the same with "on delete set null").
      setExercises((prev) => prev.filter((e) => e.id !== id).map((e) => (e.basedOnPresetId === id ? { ...e, basedOnPresetId: null } : e)))
      if (db) {
        db
          .from('exercises')
          .delete()
          .eq('id', id)
          .then(({ error }) => {
            if (error) console.error('Failed to delete exercise in Supabase', error)
          })
      }
    }, [])

    const registerPatientVisit = useCallback((name: string, email: string) => {
      // With Supabase, the patient's profile is created at sign-up (database trigger).
      if (db) return
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
    }, [])

    const recordSession = useCallback((input: NewSessionRecord) => {
      const session: SessionRecord = { ...input, id: crypto.randomUUID() }
      setSessions((prev) => [...prev, session])
      if (db) {
        const row = sessionToRow(session)
        db
          .from('sessions')
          .insert(row)
          .then(({ error }) => {
            if (!error || isAlreadySaved(error)) return
            if (isServerRefusal(error)) {
              console.error('Failed to save session to Supabase', error)
              return
            }
            // No internet (e.g. still on the hub's WiFi): keep it and upload later.
            queuePendingSession(row)
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
        createPlanFromPreset,
        updateExercise,
        deleteExercise,
        registerPatientVisit,
        recordSession,
      }),
      [exercises, patients, sessions, loading, addExercise, createPlanFromPreset, updateExercise, deleteExercise, registerPatientVisit, recordSession],
    )

    return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
  }
}

/** The app's data: Supabase when configured, otherwise this browser's localStorage. */
export const AppDataProvider = makeAppDataProvider(supabase, storageKeys())

/**
 * Developer preview only: keeps all data in this browser under a separate
 * storage prefix and never talks to Supabase, so an admin's preview of the
 * app can't read or change real records.
 */
export const PreviewAppDataProvider = makeAppDataProvider(null, storageKeys('preview'))

export function useAppData(): AppDataValue {
  const ctx = useContext(AppDataContext)
  if (!ctx) throw new Error('useAppData must be used within AppDataProvider')
  return ctx
}
