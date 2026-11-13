import { useMemo, type ReactNode } from 'react'
import { NavLink, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { FlaskConical } from 'lucide-react'
import { clsx } from 'clsx'
import { PageShell } from '@/components/layout/PageShell'
import { Logo } from '@/components/layout/Logo'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { RosterView } from '@/components/dashboard/RosterView'
import { PatientPageView } from '@/components/dashboard/PatientPageView'
import { PresetListView } from '@/components/dashboard/PresetListView'
import { ExerciseOptimizationMetrics } from '@/components/dashboard/ExerciseOptimizationMetrics'
import { buildRosterRows, bodyRegionLabel, sessionsOf, statusOf } from '@/components/dashboard/physioModel'
import { PageHeader } from '@/components/dashboard/ui/PageHeader'
import { SectionCard } from '@/components/dashboard/ui/SectionCard'
import { BackLink } from '@/components/dashboard/ui/BackLink'
import { PHYSIO_DEMO_EXERCISES, PHYSIO_DEMO_NOW, PHYSIO_DEMO_PATIENTS, PHYSIO_DEMO_PRESETS, PHYSIO_DEMO_SESSIONS } from './physioDemoData'

/**
 * Preview of the physio portal, filled from physioDemoData.ts.
 *
 * It renders the same view components as the real portal, but sits OUTSIDE
 * the app's auth, data and hub providers (see App.tsx): it has no way to read
 * or write patient records, presets or sessions. Actions that would change
 * data are hidden, and every screen carries the "Demo data" banner.
 *
 * Extra states for checking the design: /demo/physio/roster?state=loading|error|empty
 */

const SCREENS = [
  { key: 'roster', label: 'Patients' },
  { key: 'patient', label: 'Patient page' },
  { key: 'creator', label: 'Exercise Creator' },
  { key: 'preset', label: 'Preset results' },
] as const
type ScreenKey = (typeof SCREENS)[number]['key']

const READ_ONLY = "In the demo, plans and presets can't be changed. Sign in as a physiotherapist to edit them."

function DemoChrome() {
  return (
    <>
      <div role="note" className="flex items-center justify-center gap-2 bg-amber/10 px-4 py-2 text-center text-[14px] font-semibold text-amber-ink">
        <FlaskConical className="h-4 w-4 flex-shrink-0" aria-hidden />
        Demo data. Not real patients or real sessions. Nothing here is saved.
      </div>
      <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b border-border bg-surface px-4 sm:px-6">
        <Logo size="sm" />
        <nav aria-label="Demo screens" className="flex flex-wrap gap-1">
          {SCREENS.map((s) => (
            <NavLink
              key={s.key}
              to={`/demo/physio/${s.key}`}
              className={({ isActive }) =>
                clsx('rounded-full px-3 py-1.5 text-[14px] font-semibold', isActive ? 'bg-accent/10 text-accent' : 'text-ink-muted hover:bg-surface-secondary hover:text-ink')
              }
            >
              {s.label}
            </NavLink>
          ))}
        </nav>
        <ThemeToggle className="ml-auto" />
      </header>
    </>
  )
}

function DemoPlanList({ patientId }: { patientId: string }) {
  const plans = PHYSIO_DEMO_EXERCISES.filter((e) => e.assignedPatientId === patientId)
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[14px] text-ink-muted">{READ_ONLY}</p>
      {plans.map((p) => {
        const preset = PHYSIO_DEMO_PRESETS.find((x) => x.id === p.basedOnPresetId)
        const range = p.angleConfigs[0]
        return (
          <SectionCard key={p.id} title={p.title} subtitle={preset ? `Copied from preset '${preset.title}'. No changes from the preset.` : undefined}>
            <ul className="flex flex-col gap-1 text-[14px] text-ink">
              <li>{bodyRegionLabel(p.bodyRegion)}</li>
              <li>
                {p.sets} sets × {p.reps} reps · about {p.estMinutes} min
              </li>
              {range && <li>Target range {range.targetMin}–{range.targetMax}°</li>}
              <li>Drift limit {p.driftToleranceDeg}°</li>
            </ul>
          </SectionCard>
        )
      })}
    </div>
  )
}

export function PhysioDemo() {
  const { screen } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const rows = useMemo(() => buildRosterRows(PHYSIO_DEMO_PATIENTS, PHYSIO_DEMO_SESSIONS, PHYSIO_DEMO_NOW), [])

  if (!SCREENS.some((s) => s.key === screen)) return <Navigate to="/demo/physio/roster" replace />
  const go = (s: ScreenKey, query = '') => navigate(`/demo/physio/${s}${query}`)
  const openPatient = (id: string) => go('patient', `?p=${id}`)
  const state = params.get('state')

  let body: ReactNode = null
  if (screen === 'roster') {
    body = (
      <>
        <PageHeader title="Patients" subtitle="Who needs you first, based on each patient's latest session." />
        <RosterView
          rows={state === 'empty' ? [] : rows}
          loading={state === 'loading'}
          error={state === 'error' ? "Couldn't load patients. Check the connection and try again." : null}
          onRetry={() => go('roster')}
          onOpen={openPatient}
        />
      </>
    )
  } else if (screen === 'patient') {
    const patient = PHYSIO_DEMO_PATIENTS.find((p) => p.id === params.get('p')) ?? PHYSIO_DEMO_PATIENTS.find((p) => p.name.endsWith(' F'))!
    const history = sessionsOf(patient.id, PHYSIO_DEMO_SESSIONS)
    const { status, reason } = statusOf(history, PHYSIO_DEMO_NOW)
    const plans = PHYSIO_DEMO_EXERCISES.filter((e) => e.assignedPatientId === patient.id)
    body = (
      <PatientPageView
        key={patient.id}
        now={PHYSIO_DEMO_NOW}
        data={{ patient, status, reason, history, isDemo: false, plans, lastRealSessionAt: history.length ? history[history.length - 1].completedAt : null }}
        onBack={() => go('roster')}
        planPanel={<DemoPlanList patientId={patient.id} />}
      />
    )
  } else if (screen === 'creator') {
    body = <PresetListView exercises={PHYSIO_DEMO_EXERCISES} onView={(id) => go('preset', `?id=${id}`)} onEdit={() => {}} readOnlyNote={READ_ONLY} />
  } else {
    const preset = PHYSIO_DEMO_PRESETS.find((p) => p.id === params.get('id')) ?? PHYSIO_DEMO_PRESETS[0]
    body = (
      <>
        <PageHeader above={<BackLink label="Back to Exercise Creator" onClick={() => go('creator')} />} title={preset.title} subtitle="Preset results" />
        <p className="-mt-4 mb-6 text-[14px] text-ink-muted">{READ_ONLY}</p>
        <ExerciseOptimizationMetrics
          key={preset.id}
          exercise={preset}
          exercises={PHYSIO_DEMO_EXERCISES}
          patients={PHYSIO_DEMO_PATIENTS}
          sessions={PHYSIO_DEMO_SESSIONS}
          onOpenPatient={openPatient}
          now={PHYSIO_DEMO_NOW}
        />
      </>
    )
  }

  return (
    <PageShell fullWidth className="flex flex-col">
      <DemoChrome />
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-10">{body}</main>
    </PageShell>
  )
}
