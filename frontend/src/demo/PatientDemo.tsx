import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Navigate, useNavigate, useParams } from 'react-router-dom'
import { clsx } from 'clsx'
import { PageShell } from '@/components/layout/PageShell'
import { PoseOverlay } from '@/components/pose/PoseOverlay'
import { DemoBanner } from '@/components/patient/PatientBits'
import { PatientHeader, type HubState } from '@/components/patient/PatientHeader'
import { ExerciseSelectionView } from '@/components/patient/ExerciseSelectionView'
import { SensorSetupView } from '@/components/patient/SensorSetupView'
import { CalibrationView, type EffortPhase } from '@/components/patient/CalibrationView'
import { LiveSessionView } from '@/components/patient/LiveSessionView'
import { SessionSummaryView } from '@/components/patient/SessionSummaryView'
import type { VerdictDisplay } from '@/components/patient/liveVerdict'
import { sessionStats } from '@/lib/sessionStats'
import { buildDemoSessions, DEMO_EXERCISES, DEMO_LIVE_DRIFT_REP, DEMO_LIVE_VERDICTS, DEMO_PATIENT, DEMO_POD_ROWS } from './patientDemoData'

/**
 * Preview of the five patient screens, filled from patientDemoData.ts.
 *
 * It renders the same view components as the real pages, but it sits outside
 * the app's data and hub providers (see App.tsx): it cannot read or write
 * patient records, record a session, or talk to the hub. Every screen carries
 * the "Demo data" banner.
 */

const SCREENS = [
  { key: 'exercises', label: '1 Exercises' },
  { key: 'setup', label: '2 Sensors' },
  { key: 'calibrate', label: '3 Check' },
  { key: 'live', label: '4 Live' },
  { key: 'summary', label: '5 Summary' },
] as const
type ScreenKey = (typeof SCREENS)[number]['key']

const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const EXERCISE = DEMO_EXERCISES[0]
const TARGET = EXERCISE.angleConfigs[0]

function DemoChrome() {
  return (
    <>
      <DemoBanner />
      <nav aria-label="Demo screens" className="flex flex-wrap items-center justify-center gap-1.5 border-b border-border bg-surface px-4 py-2">
        {SCREENS.map((s) => (
          <NavLink
            key={s.key}
            to={`/demo/patient/${s.key}`}
            className={({ isActive }) =>
              clsx('rounded-full px-3.5 py-1.5 text-[14px] font-semibold', isActive ? 'bg-accent/10 text-accent' : 'text-ink-muted hover:bg-surface-secondary')
            }
          >
            {s.label}
          </NavLink>
        ))}
      </nav>
    </>
  )
}

function DemoCamera({ angle, fault }: { angle: number; fault: boolean }) {
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-black">
      <PoseOverlay squatDepth={angle / 135} faultActive={fault} faultDeg={fault ? 6 : 0} />
      <span className="absolute left-4 top-4 rounded-full bg-black/60 px-3 py-1.5 text-[14px] font-semibold text-white">
        Demo figure. No camera is used.
      </span>
    </div>
  )
}

/** Calibration with a scripted arm reading and timers for the (simulated) effort step. */
function DemoCalibration({ onBack, onContinue }: { onBack: () => void; onContinue: () => void }) {
  const [t, setT] = useState(0)
  const [phase, setPhase] = useState<EffortPhase>('idle')
  const [phaseStart, setPhaseStart] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setT((v) => v + 0.1), 100)
    return () => clearInterval(id)
  }, [])
  // The arm rests near 0°, then curls slowly up into the target range and back.
  const cycle = t % 12
  const liveAngle = cycle < 3 ? 2 + Math.sin(t * 3) : cycle < 9 ? Math.max(0, Math.sin(((cycle - 3) / 6) * Math.PI) * (TARGET.targetMin + 12)) : 2
  const running = phase === 'baseline' || phase === 'mvc'
  const remaining = running ? Math.max(0, 3 - (t - phaseStart)) : 0
  if (running && remaining <= 0) setPhase(phase === 'baseline' ? 'baseline-done' : 'mvc-done')
  const start = (next: EffortPhase) => {
    setPhaseStart(t)
    setPhase(next)
  }
  return (
    <CalibrationView
      exerciseTitle={EXERCISE.title}
      hubConnected
      liveAngle={liveAngle}
      targetMin={TARGET.targetMin}
      targetMax={TARGET.targetMax}
      phase={phase}
      remainingSec={Math.ceil(remaining)}
      liveEffortPct={phase === 'mvc' ? Math.min(70, (t - phaseStart) * 45) : 6}
      results={phase === 'mvc-done' ? [{ label: 'Pod 1', baseline: 0.06, mvc: 0.71 }] : []}
      onStartBaseline={() => start('baseline')}
      onStartMvc={() => start('mvc')}
      onRecalibrate={() => setPhase('idle')}
      onBack={onBack}
      onContinue={onContinue}
    />
  )
}

const REP_SECONDS = 4
const AI_DELAY_SECONDS = 1.2

/** The live screen playing the scripted session: one curl every 4 seconds. */
function DemoLive({ onEnd }: { onEnd: () => void }) {
  const [t, setT] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setT((v) => v + 0.1), 100)
    return () => clearInterval(id)
  }, [])
  const total = DEMO_LIVE_VERDICTS.length
  const repCount = Math.min(total, Math.floor(t / REP_SECONDS))
  const finished = repCount >= total
  const phase = (t % REP_SECONDS) / REP_SECONDS // 0..1 through the current rep
  const currentRep = repCount + 1
  const peak = currentRep === 7 ? TARGET.targetMin - 14 : TARGET.targetMin + 12 // rep 7 is a "Half"
  const angle = finished ? 3 : Math.max(0, Math.sin(phase * Math.PI) * peak)
  const drifting = !finished && currentRep === DEMO_LIVE_DRIFT_REP && phase > 0.3 && phase < 0.75

  let verdict: VerdictDisplay = { kind: 'waiting' }
  if (repCount > 0) {
    const label = DEMO_LIVE_VERDICTS[repCount - 1]
    const sinceRep = t - repCount * REP_SECONDS
    const nextStarted = !finished && phase > 0.12
    if (label === null) verdict = nextStarted || sinceRep > 8 ? { kind: 'not-scored' } : { kind: 'checking' }
    else verdict = sinceRep < AI_DELAY_SECONDS ? { kind: 'checking' } : { kind: 'verdict', label, good: label === 'Perfect' }
  }

  return (
    <LiveSessionView
      exerciseTitle={EXERCISE.title}
      sets={EXERCISE.sets}
      repsPerSet={EXERCISE.reps}
      repCount={repCount}
      elapsedSec={Math.floor(t)}
      angle={angle}
      targetMin={TARGET.targetMin}
      targetMax={TARGET.targetMax}
      source="hub"
      driftFault={{ active: drifting, overLimitDeg: drifting ? 6 : null }}
      verdict={verdict}
      buzzOnPerfect
      camera={<DemoCamera angle={angle} fault={drifting} />}
      details={<p>Demo: a scripted session. No hub, camera or AI server is used, and nothing is saved.</p>}
      ending={false}
      onEnd={onEnd}
    />
  )
}

export function PatientDemo() {
  const { screen } = useParams()
  const navigate = useNavigate()
  const go = (s: ScreenKey) => navigate(`/demo/patient/${s}`)
  const sessions = useMemo(() => buildDemoSessions(), [])
  const [weekAgo] = useState(() => Date.now() - WEEK_MS)
  const [hubState, setHubState] = useState<HubState>('connected')
  const [vibrating, setVibrating] = useState(false)
  const buzzTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(buzzTimer.current), [])

  if (!SCREENS.some((s) => s.key === screen)) return <Navigate to="/demo/patient/exercises" replace />

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const latest = sessions[sessions.length - 1]
  const previous = [...sessions].reverse().find((s) => s.id !== latest.id && s.exerciseId === latest.exerciseId) ?? null

  return (
    <PageShell fullWidth={screen === 'live'}>
      <DemoChrome />
      {screen === 'exercises' && (
        <ExerciseSelectionView
          header={
            <PatientHeader
              userName={DEMO_PATIENT.name}
              hubState={hubState}
              sessionsThisWeek={sessions.filter((s) => s.completedAt >= weekAgo).length}
            />
          }
          items={DEMO_EXERCISES.map((exercise) => ({
            exercise,
            doneToday: sessions.filter((s) => s.exerciseId === exercise.id && s.completedAt >= today.getTime()).pop() ?? null,
          }))}
          onStart={() => go('setup')}
        />
      )}
      {screen === 'setup' && (
        <SensorSetupView
          exercise={EXERCISE}
          rows={hubState === 'connected' ? DEMO_POD_ROWS : DEMO_POD_ROWS.map((r) => ({ ...r, signal: 'offline' as const, battery: null }))}
          hubState={hubState}
          hubUrl="ws://192.168.4.1:81"
          onHubUrlChange={() => {}}
          onConnect={() => setHubState('connected')}
          onDisconnect={() => setHubState('disconnected')}
          onTestVibration={() => {
            setVibrating(true)
            clearTimeout(buzzTimer.current)
            buzzTimer.current = setTimeout(() => setVibrating(false), 1200)
          }}
          vibrating={vibrating}
          onContinue={() => go('calibrate')}
        />
      )}
      {screen === 'calibrate' && <DemoCalibration onBack={() => go('setup')} onContinue={() => go('live')} />}
      {screen === 'live' && <DemoLive onEnd={() => go('summary')} />}
      {screen === 'summary' && (
        <SessionSummaryView
          stats={sessionStats(latest)}
          previous={previous ? sessionStats(previous) : null}
          avgEffortPct={Math.round(latest.reps.reduce((sum, r) => sum + r.emgLeft, 0) / latest.reps.length)}
          onDone={() => go('exercises')}
        />
      )}
    </PageShell>
  )
}
