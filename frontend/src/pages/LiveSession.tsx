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
import { muscleEmgTarget } from '@/lib/muscles'
import { useSensorHub } from '@/lib/hub/HubProvider'
import { CURL_DRIFT_POD_ID, CURL_FLEX_POD_ID } from '@/lib/hub/bicepCurlCounter'
import { PODS } from '@/lib/mockData'
import type { RepSample } from '@/types'

// The motor pulses for exactly 1 second the instant flexion enters the
// exercise's target corridor (see the corridor-entry effect below) — no
// periodic retrigger, since it's an edge-triggered "you reached it" cue,
// not a sustained correction signal.
const HAPTIC_PULSE_MS = 1000

// Testing flag: disable MediaPipe camera-based pose detection entirely so
// the hub's real MPU flex/drift data (via hub.curl, computed in HubProvider)
// is the only input driving the rep counter, instead of it being masked by
// vision whenever someone's in frame. Flip back to true to restore camera-based detection.
const ENABLE_MEDIAPIPE_VISION = false

export function LiveSession() {
  const { exerciseId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { exercises, patients, recordSession } = useAppData()
  const exercise = useMemo(() => exercises.find((e) => e.id === exerciseId) ?? null, [exercises, exerciseId])
  const [ending, setEnding] = useState(false)
  const [vision, setVision] = useState<VisionReading | null>(null)
  const hub = useSensorHub()
  const hubConnected = hub.connectionState === 'connected'

  const primaryAngle = exercise?.angleConfigs[0] ?? null
  const monitoredSide = primaryAngle ? podSide(primaryAngle.nodeA) : 'right'
  const hapticPod = kneePodForSide(monitoredSide)

  const simulated = useSensorStream(!ending, primaryAngle?.targetMin ?? null, primaryAngle?.targetMax ?? null)
  const squatDepth = Math.max(0, Math.min(1, 1 - (simulated.kneeFlexionDeg - 70) / 60))

  // Real flex/drift from the hub's two MPU6050 pods (2 = forearm flexion,
  // 3 = upper-arm drift — see firmware/smartphysio_hub/smartphysio_hub.ino).
  // The rep-counting/cheat-detection algorithm itself (hub.curl) runs inside
  // HubProvider, synchronously per incoming message — see bicepCurlCounter.ts
  // for why it can't be driven from here as a plain rendered-value effect.
  const flexLive = hub.pods[CURL_FLEX_POD_ID]?.pitchDeg ?? null
  const driftLive = hub.pods[CURL_DRIFT_POD_ID]?.pitchDeg ?? null
  const curl = hub.curl
  const usingHubCurl = flexLive !== null && driftLive !== null

  // Hybrid multimodal decision engine: prefer the camera's real joint-angle
  // reading when a person is in frame, then the hub's real MPU curl
  // algorithm when connected, falling back to the wearable simulator only
  // when neither real source is available.
  const usingVision = vision !== null
  const kneeFlexionDeg = vision?.flexionDeg ?? (usingHubCurl ? flexLive : simulated.kneeFlexionDeg)
  const faultActive = vision?.faultActive ?? (usingHubCurl ? curl.formCheatDetected : simulated.faultActive)
  const faultDeg = vision ? Math.round(vision.valgusDeg) : usingHubCurl ? Math.round(curl.driftError) : simulated.faultDeg
  const faultLabel = faultActive
    ? usingHubCurl && !usingVision
      ? `Upper-Arm Drift Detected (+${faultDeg}° Over Baseline)`
      : `${monitoredSide === 'left' ? 'Left' : 'Right'} Knee Valgus Detected (+${faultDeg}° Fault)`
    : null
  const repCount = usingHubCurl ? curl.repCount : simulated.repCount

  const targetMin = primaryAngle?.targetMin ?? simulated.targetMin
  const targetMax = primaryAngle?.targetMax ?? simulated.targetMax
  const inCorridor = kneeFlexionDeg >= targetMin && kneeFlexionDeg <= targetMax

  // Real EMG pods (1 = left vastus medialis, 2 = right) once that specific
  // pod has actually reported an EMG reading; otherwise the wearable
  // simulator, same as the knee angle above. This is independent of
  // hubConnected since a real hub (e.g. IMU-only hardware) may not have EMG
  // wired up at all yet.
  const emgLeftLive = hub.pods[1]?.emgActivationPct
  const emgRightLive = hub.pods[2]?.emgActivationPct
  const usingHubEmg = emgLeftLive !== undefined || emgRightLive !== undefined
  const emgLeft = emgLeftLive !== undefined ? Math.round(emgLeftLive) : simulated.emgLeft
  const emgRight = emgRightLive !== undefined ? Math.round(emgRightLive) : simulated.emgRight

  // Target-corridor feedback: pulse the monitored pod for exactly 1 second
  // the instant flexion enters the exercise's target corridor (150°-180° for
  // the default Bicep Curl). Purely edge-triggered — holding inside the
  // corridor doesn't retrigger the buzz — and `pulseActive` (rather than just
  // `inCorridor`) drives the UI so the "Pod X Active" badge tracks the real
  // ~1s motor pulse window instead of however long the arm stays in range.
  const [pulseActive, setPulseActive] = useState(false)
  const wasInCorridor = useRef(false)
  const pulseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (inCorridor && !wasInCorridor.current) {
      setPulseActive(true)
      if (pulseTimeoutRef.current) clearTimeout(pulseTimeoutRef.current)
      pulseTimeoutRef.current = setTimeout(() => setPulseActive(false), HAPTIC_PULSE_MS)
      if (hubConnected) hub.sendHaptic(hapticPod, HAPTIC_PULSE_MS).catch(() => {})
    }
    wasInCorridor.current = inCorridor
  }, [inCorridor, hubConnected, hub, hapticPod])

  useEffect(() => {
    return () => {
      if (pulseTimeoutRef.current) clearTimeout(pulseTimeoutRef.current)
    }
  }, [])

  const activeHapticPod = pulseActive ? hapticPod : null

  // Rep-by-rep telemetry: sample the effective angle/EMG the instant each
  // rep completes, so a finished session leaves behind real per-rep data
  // instead of nothing — this is what Session Analytics reads back later.
  const [repSamples, setRepSamples] = useState<RepSample[]>([])
  const prevRepCount = useRef(0)
  useEffect(() => {
    if (repCount > prevRepCount.current) {
      prevRepCount.current = repCount
      setRepSamples((prev) => [...prev, { rep: repCount, angle: Math.round(kneeFlexionDeg), emgLeft, emgRight, faultActive }])
    }
  }, [repCount, kneeFlexionDeg, emgLeft, emgRight, faultActive])

  if (!exercise) {
    return (
      <PageShell>
        <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
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
    const session =
      patient && repSamples.length > 0
        ? recordSession({
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
        : null
    setTimeout(() => navigate(session ? `/patient/session-summary/${session.id}` : '/patient/exercises'), 900)
  }

  const mm = String(Math.floor(simulated.elapsedSec / 60)).padStart(2, '0')
  const ss = String(simulated.elapsedSec % 60).padStart(2, '0')

  return (
    <PageShell>
      <header className="translucent-header sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-6 lg:px-10 lg:py-4">
        <Logo size="sm" />
        <Breadcrumb
          steps={[{ label: 'Step 1: Sensor Placement' }, { label: 'Step 2: Calibration' }, { label: 'Step 3: Live Session' }]}
          activeIndex={2}
        />
        <div className="flex items-center gap-3 text-sm text-ink-muted sm:gap-5">
          <span className="flex items-center gap-1.5">
            <Timer className="h-4 w-4 text-accent" />
            {mm}:{ss}
          </span>
          <span className="flex items-center gap-1.5">
            <Repeat className="h-4 w-4 text-accent" />
            {repCount} reps
          </span>
          <ThemeToggle />
        </div>
      </header>

      <main className="grid grid-cols-1 gap-6 px-4 py-6 sm:px-6 sm:py-8 lg:grid-cols-[1.5fr_1fr] lg:px-10 lg:py-10">
        {/* Primary viewport */}
        <div className="flex flex-col gap-4">
          <CameraViewport
            monitoredSide={monitoredSide}
            faultThresholdDeg={primaryAngle?.faultThresholdDeg ?? 8}
            onVisionMetrics={setVision}
            poseDetectionEnabled={ENABLE_MEDIAPIPE_VISION}
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
                : usingHubCurl
                  ? "MediaPipe is disabled — flexion, drift and rep counting below are computed live from the ESP32's MPU6050 pods, run through the same curl algorithm as the firmware."
                  : 'No live camera reading right now, so the knee angle and fault state below are simulated from the wearable stream, per the hybrid multimodal decision engine.'}
            </p>
          </Card>
        </div>

        {/* Secondary column */}
        <div className="flex flex-col gap-6">
          <Card className="flex flex-col items-center p-6">
            {/* min/max span the full rep sweep (extended to contracted), not just
                the target corridor, since kneeFlexionDeg travels across the whole
                range every rep — clamping tightly around target (as the other two
                RadialGauge call sites do for their narrower, target-relative
                stats) made every rep's bottom half collapse to a flat "empty" arc. */}
            <RadialGauge
              value={kneeFlexionDeg}
              min={0}
              max={Math.max(200, targetMax + 20)}
              targetMin={targetMin}
              targetMax={targetMax}
              label="Joint Angle"
              fault={faultActive}
            />
            <span
              className={`mt-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${usingVision || usingHubCurl ? 'bg-accent/10 text-accent' : 'bg-surface-secondary text-ink-faint'}`}
            >
              {usingVision ? 'Source: Live Camera (MediaPipe)' : usingHubCurl ? 'Source: Live Hub (MPU)' : 'Source: Wearable Simulation'}
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
            <EmgActivationBar label="Left Quad" value={emgLeft} target={muscleEmgTarget(exercise.muscleEmgTargets, 'left-vastus-medialis')} />
            <EmgActivationBar label="Right Quad" value={emgRight} target={muscleEmgTarget(exercise.muscleEmgTargets, 'right-vastus-medialis')} />
          </Card>

          <Card className="p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-ink">Haptic Biofeedback</h3>
              {activeHapticPod && (
                <span className="flex items-center gap-1.5 text-[13px] font-semibold text-emerald">
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
                ? `Target Corridor Reached — pulsing pod ${activeHapticPod} for 1s`
                : `Curl into the ${targetMin}°–${targetMax}° corridor to trigger haptic feedback`}
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
