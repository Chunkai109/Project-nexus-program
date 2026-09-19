import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, TriangleAlert, Vibrate, Timer, Repeat, ScanEye } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { Logo } from '@/components/layout/Logo'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { RadialGauge } from '@/components/charts/RadialGauge'
import { EmgActivationBar } from '@/components/charts/EmgActivationBar'
import { CameraViewport, type VisionReading } from '@/components/pose/CameraViewport'
import { PoseOverlay } from '@/components/pose/PoseOverlay'
import { BodyMap } from '@/components/body/BodyMap'
import { useSensorStream } from '@/lib/useSensorStream'
import { useAppData } from '@/lib/data/AppDataContext'
import { useAuth } from '@/lib/AuthContext'
import { podSide, kneePodForSide } from '@/lib/podUtils'
import { useBleHub } from '@/lib/ble/BleProvider'
import { PODS } from '@/lib/mockData'
import type { RepSample } from '@/types'

const HAPTIC_PULSE_MS = 400
const HAPTIC_RETRIGGER_COOLDOWN_MS = 1500

export function LiveSession() {
  const { exerciseId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { exercises, patients, recordSession } = useAppData()
  const exercise = useMemo(() => exercises.find((e) => e.id === exerciseId) ?? null, [exercises, exerciseId])
  const [ending, setEnding] = useState(false)
  const [vision, setVision] = useState<VisionReading | null>(null)
  const hub = useBleHub()
  const hubConnected = hub.connectionState === 'connected'

  const primaryAngle = exercise?.angleConfigs[0] ?? null
  const monitoredSide = primaryAngle ? podSide(primaryAngle.nodeA) : 'right'
  const hapticPod = kneePodForSide(monitoredSide)

  const simulated = useSensorStream(!ending, primaryAngle?.targetMin ?? null, primaryAngle?.targetMax ?? null)
  const squatDepth = Math.max(0, Math.min(1, 1 - (simulated.kneeFlexionDeg - 70) / 60))

  // Hybrid multimodal decision engine: prefer the camera's real joint-angle
  // reading when a person is in frame, fall back to the wearable simulator
  // otherwise (no camera, model still loading, or nobody in shot).
  const usingVision = vision !== null
  const kneeFlexionDeg = vision?.flexionDeg ?? simulated.kneeFlexionDeg
  const faultActive = vision?.faultActive ?? simulated.faultActive
  const faultDeg = vision ? Math.round(vision.valgusDeg) : simulated.faultDeg
  const faultLabel = faultActive
    ? `${monitoredSide === 'left' ? 'Left' : 'Right'} Knee Valgus Detected (+${faultDeg}° Fault)`
    : null
  const activeHapticPod = faultActive ? hapticPod : null

  // Real EMG pods (1 = left vastus medialis, 2 = right) when a hub is
  // connected; otherwise the wearable simulator, same as the knee angle above.
  const usingHubEmg = hubConnected
  const emgLeft = usingHubEmg ? Math.round(hub.pods[1]?.emgActivationPct ?? 0) : simulated.emgLeft
  const emgRight = usingHubEmg ? Math.round(hub.pods[2]?.emgActivationPct ?? 0) : simulated.emgRight

  // Closed-loop correction: when a real hub is connected, tell it to buzz
  // the monitored knee pod the instant a fault starts, rather than only
  // showing it on screen. Edge-triggered with a cooldown so a sustained
  // fault doesn't flood the link with GATT writes.
  const lastHapticSentAt = useRef(0)
  const wasFaultActive = useRef(false)
  useEffect(() => {
    if (!hubConnected) {
      wasFaultActive.current = faultActive
      return
    }
    const risingEdge = faultActive && !wasFaultActive.current
    const cooldownElapsed = performance.now() - lastHapticSentAt.current > HAPTIC_RETRIGGER_COOLDOWN_MS
    if (risingEdge || (faultActive && cooldownElapsed)) {
      lastHapticSentAt.current = performance.now()
      hub.sendHaptic(hapticPod, HAPTIC_PULSE_MS).catch(() => {})
    }
    wasFaultActive.current = faultActive
  }, [faultActive, hubConnected, hub, hapticPod])

  // Rep-by-rep telemetry: sample the effective angle/EMG the instant each
  // rep completes, so a finished session leaves behind real per-rep data
  // instead of nothing — this is what Session Analytics reads back later.
  const [repSamples, setRepSamples] = useState<RepSample[]>([])
  const prevRepCount = useRef(0)
  useEffect(() => {
    if (simulated.repCount > prevRepCount.current) {
      prevRepCount.current = simulated.repCount
      setRepSamples((prev) => [
        ...prev,
        { rep: simulated.repCount, angle: Math.round(kneeFlexionDeg), emgLeft, emgRight, faultActive },
      ])
    }
  }, [simulated.repCount, kneeFlexionDeg, emgLeft, emgRight, faultActive])

  if (!exercise) {
    return (
      <PageShell>
        <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-10 text-center">
          <p className="text-[17px] font-semibold text-ink">Exercise not found</p>
          <p className="max-w-sm text-[14px] text-ink-faint">
            This protocol may have been removed by your physiotherapist. Head back to your exercise list to see what's currently assigned.
          </p>
          <Button onClick={() => navigate('/patient/exercises')}>
            <ArrowLeft className="h-4 w-4" />
            Back to Exercises
          </Button>
        </main>
      </PageShell>
    )
  }

  function handleEnd() {
    setEnding(true)
    if (!exercise) return
    const patient = patients.find((p) => p.email === user?.email)
    if (patient && repSamples.length > 0) {
      recordSession({
        patientId: patient.id,
        patientName: patient.name,
        exerciseId: exercise.id,
        exerciseTitle: exercise.title,
        completedAt: Date.now(),
        durationSec: simulated.elapsedSec,
        targetMin: primaryAngle?.targetMin ?? simulated.targetMin,
        targetMax: primaryAngle?.targetMax ?? simulated.targetMax,
        reps: repSamples,
      })
    }
    setTimeout(() => navigate('/patient/exercises'), 900)
  }

  const mm = String(Math.floor(simulated.elapsedSec / 60)).padStart(2, '0')
  const ss = String(simulated.elapsedSec % 60).padStart(2, '0')

  return (
    <PageShell>
      <header className="translucent-header sticky top-0 z-20 flex items-center justify-between border-b border-border px-10 py-4">
        <Logo size="sm" />
        <Breadcrumb
          steps={[{ label: 'Step 1: Sensor Placement' }, { label: 'Step 2: Calibration' }, { label: 'Step 3: Live Session' }]}
          activeIndex={2}
        />
        <div className="flex items-center gap-5 text-sm text-ink-muted">
          <span className="flex items-center gap-1.5">
            <Timer className="h-4 w-4 text-accent" />
            {mm}:{ss}
          </span>
          <span className="flex items-center gap-1.5">
            <Repeat className="h-4 w-4 text-accent" />
            {simulated.repCount} reps
          </span>
          <ThemeToggle />
        </div>
      </header>

      <main className="grid grid-cols-1 gap-6 px-10 py-10 lg:grid-cols-[1.5fr_1fr]">
        {/* Primary viewport */}
        <div className="flex flex-col gap-4">
          <CameraViewport
            monitoredSide={monitoredSide}
            faultThresholdDeg={exercise.faultThresholdDeg}
            onVisionMetrics={setVision}
            fallbackSkeleton={
              <PoseOverlay squatDepth={squatDepth} faultActive={faultActive} faultDeg={faultDeg} />
            }
          >
            {faultActive && faultLabel && (
              <div className="animate-pulse-ring-crimson absolute bottom-4 left-4 flex items-center gap-2 rounded-lg border border-crimson/40 bg-crimson/15 px-3 py-2 text-xs font-semibold text-crimson backdrop-blur-sm">
                <TriangleAlert className="h-4 w-4" />
                {faultLabel}
              </div>
            )}

            <div className="absolute right-4 top-4 rounded-full bg-black/50 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
              {exercise.title}
            </div>
          </CameraViewport>

          <Card className="flex items-start gap-2.5 p-5">
            <ScanEye className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent" />
            <p className="text-[13px] text-ink-faint">
              {usingVision
                ? 'Knee angle is being measured live from your camera via MediaPipe Pose. Wearable pods still supply EMG and localized limb rotation the camera alone can\'t see.'
                : 'No live camera reading right now, so the knee angle and fault state below are simulated from the wearable stream, per the hybrid multimodal decision engine.'}
            </p>
          </Card>
        </div>

        {/* Secondary column */}
        <div className="flex flex-col gap-6">
          <Card className="flex flex-col items-center p-6">
            <RadialGauge
              value={kneeFlexionDeg}
              min={40}
              max={150}
              targetMin={simulated.targetMin}
              targetMax={simulated.targetMax}
              label="Knee Flexion Angle"
              fault={faultActive}
            />
            <span
              className={`mt-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${usingVision ? 'bg-accent/10 text-accent' : 'bg-surface-secondary text-ink-faint'}`}
            >
              {usingVision ? 'Source: Live Camera (MediaPipe)' : 'Source: Wearable Simulation'}
            </span>
          </Card>

          <Card className="flex flex-col gap-5 p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-ink">EMG Activation</h3>
              <span
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${usingHubEmg ? 'bg-emerald/10 text-emerald' : 'bg-surface-secondary text-ink-faint'}`}
              >
                {usingHubEmg ? 'Source: Live Hub' : 'Source: Wearable Simulation'}
              </span>
            </div>
            <EmgActivationBar label="Left Quad" value={emgLeft} target={exercise.targetEmgMvc} />
            <EmgActivationBar label="Right Quad" value={emgRight} target={exercise.targetEmgMvc} />
          </Card>

          <Card className="p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-ink">Haptic Biofeedback</h3>
              {activeHapticPod && (
                <span className="flex items-center gap-1.5 text-[13px] font-semibold text-crimson">
                  <Vibrate className="h-3.5 w-3.5" />
                  Pod {activeHapticPod} Active
                </span>
              )}
            </div>
            <div>
              <BodyMap pods={PODS} hapticPodId={activeHapticPod} height={170} />
            </div>
            <p className="mt-3 text-center text-[13px] text-ink-muted">
              {activeHapticPod
                ? `Vibrotactile Correction Active — realign ${monitoredSide} knee over ankle`
                : 'Form within target corridor — no correction needed'}
            </p>
          </Card>

          <Button variant="danger" size="lg" className="w-full" onClick={handleEnd} disabled={ending}>
            {ending ? 'Syncing session data…' : 'End Session & Sync Data'}
          </Button>
        </div>
      </main>
    </PageShell>
  )
}
