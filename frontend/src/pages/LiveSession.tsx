import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { TriangleAlert, Vibrate, Timer, Repeat, ScanEye } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { Logo } from '@/components/layout/Logo'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { GlassCard } from '@/components/ui/GlassCard'
import { Button } from '@/components/ui/Button'
import { RadialGauge } from '@/components/charts/RadialGauge'
import { EmgActivationBar } from '@/components/charts/EmgActivationBar'
import { CameraViewport, type VisionReading } from '@/components/pose/CameraViewport'
import { PoseOverlay } from '@/components/pose/PoseOverlay'
import { BodyMap } from '@/components/body/BodyMap'
import { useSensorStream } from '@/lib/useSensorStream'
import { useBleHub } from '@/lib/ble/BleProvider'
import type { PodId } from '@/lib/ble/protocol'
import { EXERCISES, PODS } from '@/lib/mockData'

const MONITORED_SIDE = 'right'
const VALGUS_HAPTIC_POD = 4 as PodId
const HAPTIC_PULSE_MS = 400
const HAPTIC_RETRIGGER_COOLDOWN_MS = 1500

export function LiveSession() {
  const { exerciseId } = useParams()
  const navigate = useNavigate()
  const exercise = useMemo(() => EXERCISES.find((e) => e.id === exerciseId) ?? EXERCISES[0], [exerciseId])
  const [ending, setEnding] = useState(false)
  const [vision, setVision] = useState<VisionReading | null>(null)
  const hub = useBleHub()
  const hubConnected = hub.connectionState === 'connected'

  const simulated = useSensorStream(!ending, exercise)
  const squatDepth = Math.max(0, Math.min(1, 1 - (simulated.kneeFlexionDeg - 70) / 60))

  // Hybrid multimodal decision engine: prefer the camera's real joint-angle
  // reading when a person is in frame, fall back to the wearable simulator
  // otherwise (no camera, model still loading, or nobody in shot).
  const usingVision = vision !== null
  const kneeFlexionDeg = vision?.flexionDeg ?? simulated.kneeFlexionDeg
  const faultActive = vision?.faultActive ?? simulated.faultActive
  const faultDeg = vision ? Math.round(vision.valgusDeg) : simulated.faultDeg
  const faultLabel = faultActive ? `Knee Valgus Detected (+${faultDeg}° Fault)` : null
  const activeHapticPod = faultActive ? VALGUS_HAPTIC_POD : null

  // Real EMG pods (1 = left vastus medialis, 2 = right) when a hub is
  // connected; otherwise the wearable simulator, same as the knee angle above.
  const usingHubEmg = hubConnected
  const emgLeft = usingHubEmg ? Math.round(hub.pods[1]?.emgActivationPct ?? 0) : simulated.emgLeft
  const emgRight = usingHubEmg ? Math.round(hub.pods[2]?.emgActivationPct ?? 0) : simulated.emgRight

  // Closed-loop correction: when a real hub is connected, tell it to buzz
  // the right-knee pod the instant a fault starts, rather than only showing
  // it on screen. Edge-triggered with a cooldown so a sustained fault
  // doesn't flood the link with GATT writes.
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
      hub.sendHaptic(VALGUS_HAPTIC_POD, HAPTIC_PULSE_MS).catch(() => {})
    }
    wasFaultActive.current = faultActive
  }, [faultActive, hubConnected, hub])

  function handleEnd() {
    setEnding(true)
    setTimeout(() => navigate('/patient/exercises'), 900)
  }

  const mm = String(Math.floor(simulated.elapsedSec / 60)).padStart(2, '0')
  const ss = String(simulated.elapsedSec % 60).padStart(2, '0')

  return (
    <PageShell>
      <header className="flex items-center justify-between border-b border-border px-8 py-5">
        <Logo size="sm" />
        <Breadcrumb
          steps={[{ label: 'Step 1: Sensor Placement' }, { label: 'Step 2: Calibration' }, { label: 'Step 3: Live Session' }]}
          activeIndex={2}
        />
        <div className="flex items-center gap-4 text-sm text-ink-muted">
          <span className="flex items-center gap-1.5">
            <Timer className="h-4 w-4 text-electric" />
            {mm}:{ss}
          </span>
          <span className="flex items-center gap-1.5">
            <Repeat className="h-4 w-4 text-electric" />
            {simulated.repCount} reps
          </span>
        </div>
      </header>

      <main className="grid grid-cols-1 gap-6 px-8 py-8 lg:grid-cols-[1.5fr_1fr]">
        {/* Primary viewport */}
        <div className="flex flex-col gap-4">
          <CameraViewport
            monitoredSide={MONITORED_SIDE}
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

          <GlassCard className="flex items-start gap-2 p-4">
            <ScanEye className="mt-0.5 h-4 w-4 flex-shrink-0 text-electric" />
            <p className="text-xs text-ink-faint">
              {usingVision
                ? 'Knee angle is being measured live from your camera via MediaPipe Pose. Wearable pods still supply EMG and localized limb rotation the camera alone can\'t see.'
                : 'No live camera reading right now, so the knee angle and fault state below are simulated from the wearable stream, per the hybrid multimodal decision engine.'}
            </p>
          </GlassCard>
        </div>

        {/* Secondary column */}
        <div className="flex flex-col gap-5">
          <GlassCard className="flex flex-col items-center p-5">
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
              className={`mt-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${usingVision ? 'bg-electric/10 text-electric' : 'bg-white/5 text-ink-faint'}`}
            >
              {usingVision ? 'Source: Live Camera (MediaPipe)' : 'Source: Wearable Simulation'}
            </span>
          </GlassCard>

          <GlassCard className="flex flex-col gap-4 p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink">EMG Activation</h3>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${usingHubEmg ? 'bg-emerald/10 text-emerald' : 'bg-white/5 text-ink-faint'}`}
              >
                {usingHubEmg ? 'Source: Live Hub' : 'Source: Wearable Simulation'}
              </span>
            </div>
            <EmgActivationBar label="Left Quad" value={emgLeft} target={exercise.targetEmgMvc} />
            <EmgActivationBar label="Right Quad" value={emgRight} target={exercise.targetEmgMvc} />
          </GlassCard>

          <GlassCard className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink">Haptic Biofeedback</h3>
              {activeHapticPod && (
                <span className="flex items-center gap-1.5 text-xs font-semibold text-crimson">
                  <Vibrate className="h-3.5 w-3.5" />
                  Pod {activeHapticPod} Active
                </span>
              )}
            </div>
            <div>
              <BodyMap pods={PODS} hapticPodId={activeHapticPod} height={170} />
            </div>
            <p className="mt-2 text-center text-xs text-ink-muted">
              {activeHapticPod
                ? 'Vibrotactile Correction Active — realign right knee over ankle'
                : 'Form within target corridor — no correction needed'}
            </p>
          </GlassCard>

          <Button variant="danger" size="lg" className="w-full" onClick={handleEnd} disabled={ending}>
            {ending ? 'Syncing session data…' : 'End Session & Sync Data'}
          </Button>
        </div>
      </main>
    </PageShell>
  )
}
