import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Eye } from 'lucide-react'
import { PreviewAuthProvider, useAuth } from '@/lib/AuthContext'
import { PreviewAppDataProvider, useAppData } from '@/lib/data/AppDataContext'
import { homeFor } from '@/lib/homeFor'
import { DEV_PREVIEW_AVAILABLE, DevPreviewContext, PREVIEW_PATIENT, STORAGE_KEY, previewUser, readStored, useDevPreview, type PreviewRole } from './devPreviewState'

/**
 * Developer preview: on a development build only (`npm run dev`), an admin
 * can open the app as a test patient or a test physio with no login.
 *
 * - The admin stays signed in underneath; "Back to Admin" ends the preview.
 * - The preview runs on its own sandbox data in this browser
 *   (PreviewAppDataProvider). It never reads or writes Supabase or the
 *   normal local data, so no real record can be seen or changed.
 * - The patient and physio previews share that sandbox, so a session done
 *   as the test patient shows up for the test physio.
 * - In a release build (the desktop installer) `import.meta.env.DEV` is
 *   false: the button is not shown and a stored preview is ignored.
 */
/** Holds which preview (if any) is open. Kept for this tab only, so a reload stays in the preview. */
export function DevPreviewProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<PreviewRole | null>(() => (DEV_PREVIEW_AVAILABLE ? readStored() : null))
  const start = useCallback((next: PreviewRole) => {
    if (!DEV_PREVIEW_AVAILABLE) return
    try {
      window.sessionStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Storage blocked: the preview still opens, it just won't survive a reload.
    }
    setRole(next)
  }, [])
  const end = useCallback(() => {
    try {
      window.sessionStorage.removeItem(STORAGE_KEY)
    } catch {
      // nothing stored
    }
    setRole(null)
  }, [])
  const value = useMemo(() => ({ role, start, end }), [role, start, end])
  return <DevPreviewContext.Provider value={value}>{children}</DevPreviewContext.Provider>
}

function PreviewBar({ role, onEnd }: { role: PreviewRole; onEnd: () => void }) {
  return (
    <div role="note" className="sticky top-0 z-50 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 bg-ink px-4 py-1.5 text-[14px] font-semibold text-canvas">
      <span className="inline-flex items-center gap-2">
        <Eye className="h-4 w-4 flex-shrink-0" aria-hidden />
        Admin preview: {role === 'patient' ? 'patient app' : 'physio portal'}, as a test account. Sandbox data, nothing real is saved.
      </span>
      <button type="button" onClick={onEnd} className="inline-flex min-h-[32px] items-center gap-1.5 rounded-md px-2 underline">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to Admin
      </button>
    </div>
  )
}

/**
 * Gives the sandbox a test patient with one exercise plan, so the patient
 * preview has something to do and the physio preview has someone to see.
 */
function SeedSandbox() {
  const { patients, exercises, registerPatientVisit, createPlanFromPreset } = useAppData()
  const seeding = useRef(false)
  // The first try can run before the data layer has caught up with the presets it just created; try again a few times.
  const [attempt, setAttempt] = useState(0)
  const patient = patients.find((p) => p.email === PREVIEW_PATIENT.email)
  useEffect(() => {
    if (!patient) registerPatientVisit(PREVIEW_PATIENT.name, PREVIEW_PATIENT.email)
  }, [patient, registerPatientVisit])
  useEffect(() => {
    if (!patient || seeding.current || exercises.some((e) => e.assignedPatientId === patient.id)) return
    const preset = exercises.find((e) => e.assignedPatientId === null && e.title === 'Bicep Curl') ?? exercises.find((e) => e.assignedPatientId === null)
    if (!preset) return
    seeding.current = true
    // NewExercise is the preset's fields without its identity and history.
    const { id: _id, createdAt: _c, updatedAt: _u, basedOnPresetId: _b, presetSnapshotAt: _s, ...fields } = preset
    void createPlanFromPreset(preset.id, patient.id, { ...fields, assignedPatientId: patient.id }).catch(() => {
      seeding.current = false
      if (attempt < 5) setTimeout(() => setAttempt((n) => n + 1), 50)
    })
  }, [patient, exercises, createPlanFromPreset, attempt])
  return null
}

/**
 * Wraps the app's routes. When a preview is open and the signed-in account
 * is really an admin on a development build, the routes run inside the
 * preview's own sign-in and sandbox data instead of the real ones.
 */
export function WithDevPreview({ real, children }: { real: (children: ReactNode) => ReactNode; children: ReactNode }) {
  const { user, initializing } = useAuth()
  const { role, end } = useDevPreview()
  const navigate = useNavigate()
  const active = DEV_PREVIEW_AVAILABLE && role !== null && user?.role === 'admin'
  const endPreview = useCallback(() => {
    end()
    navigate('/admin', { replace: true })
  }, [end, navigate])

  // A stored preview with no admin signed in (signed out, or not an admin) is dropped.
  useEffect(() => {
    if (!initializing && role !== null && user?.role !== 'admin') end()
  }, [initializing, role, user, end])

  const testUser = useMemo(() => (active && user ? previewUser(role!, user.practiceId) : null), [active, role, user])

  // Land on the test account's home page when the preview opens.
  const landed = useRef<PreviewRole | null>(null)
  useEffect(() => {
    if (testUser && landed.current !== testUser.role) {
      landed.current = testUser.role as PreviewRole
      navigate(homeFor(testUser.role), { replace: true })
    }
    if (!testUser) landed.current = null
  }, [testUser, navigate])

  if (!testUser) return <>{real(children)}</>
  return (
    <PreviewAuthProvider user={testUser} onEnd={endPreview}>
      <PreviewAppDataProvider>
        <PreviewBar role={testUser.role as PreviewRole} onEnd={endPreview} />
        <SeedSandbox />
        {children}
      </PreviewAppDataProvider>
    </PreviewAuthProvider>
  )
}
