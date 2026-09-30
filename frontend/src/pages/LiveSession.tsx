import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, TriangleAlert, Vibrate, Timer, Repeat, ScanEye, Loader2 } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { Logo } from '@/components/layout/Logo'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { RadialGauge } from '@/components/charts/RadialGauge'
import { EmgActivationBar } from '@/components/charts/EmgActivationBar'
import { CameraViewport } from '@/components/pose/CameraViewport'
import { PoseOverlay } from '@/components/pose/PoseOverlay'
import { BodyMap } from '@/components/body/BodyMap'
import { useSensorStream } from '@/lib/useSensorStream'
import { useAppData } from '@/lib/data/AppDataContext'
import { useAuth } from '@/lib/AuthContext'
import { muscleEmgTarget } from '@/lib/muscles'
import { useSensorHub } from '@/lib/hub/HubProvider'
import { CURL_DRIFT_POD_ID, CURL_FLEX_POD_ID, POD_HAPTIC_CORRIDOR, POD_HAPTIC_FAULT } from '@/lib/hub/bicepCurlCounter'
import { predictVisionForm, predictFusedForm, MIN_VISION_FRAMES, type VisionPrediction, type FusedPrediction } from '@/lib/visionModel'
import { PODS } from '@/lib/mockData'
import type { RepSample } from '@/types'

// The motor pulses for exactly 1 second the instant flexion enters the
// exercise's target corridor (see the corridor-entry effect below) — no
// periodic retrigger, since it's an edge-triggered "you reached it" cue,
// not a sustained correction signal.
const HAPTIC_PULSE_MS = 1000

// MediaPipe camera-based pose detection — was a hardcoded-off testing flag
// to isolate the hub's MPU-only rep counter; now on by default so the
// camera actually feeds the trained vision model (see the world-landmarks
// buffering below and ensemble/FRONTEND_INTEGRATION.md Section 5). Flip
// back to false to go back to testing MPU-only, camera-disabled.
const ENABLE_MEDIAPIPE_VISION = true

type FormCheckState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'result'; result: VisionPrediction | FusedPrediction }
  | { status: 'unavailable' }
  | { status: 'insufficient_frames'; frameCount: number }

export function LiveSession() {
  const { exerciseId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { exercises, patients, recordSession } = useAppData()
  const exercise = useMemo(() => exercises.find((e) => e.id === exerciseId) ?? null, [exercises, exerciseId])
  const [ending, setEnding] = useState(false)
  const hub = useSensorHub()
  const hubConnected = hub.connectionState === 'connected'

  const primaryAngle = exercise?.angleConfigs[0] ?? null

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

  // The hub's real MPU curl algorithm when connected, falling back to the
  // wearable simulator otherwise. (The camera feed below still runs its own
  // MediaPipe pose detection for AI Form Check — see the fused/vision-only
  // predict call further down — it just isn't used for this angle/fault
  // reading, since the trained knee-valgus vision math doesn't apply to an
  // elbow curl.)
  const kneeFlexionDeg = usingHubCurl ? flexLive : simulated.kneeFlexionDeg
  const faultActive = usingHubCurl ? curl.formCheatDetected : simulated.faultActive
  const faultDeg = usingHubCurl ? Math.round(curl.driftError) : simulated.faultDeg
  const faultLabel = faultActive ? `Upper-Arm Drift Detected (+${faultDeg}° Over Baseline)` : null
  const repCount = usingHubCurl ? curl.repCount : simulated.repCount

  const targetMin = primaryAngle?.targetMin ?? simulated.targetMin
  const targetMax = primaryAngle?.targetMax ?? simulated.targetMax
  const inCorridor = kneeFlexionDeg >= targetMin && kneeFlexionDeg <= targetMax

  // Real EMG from Pod 1 — the sole EMG-capable pod on this rig (bicep) —
  // once it has actually reported a reading; otherwise the wearable
  // simulator, same as the knee angle above. This is independent of
  // hubConnected since a real hub (e.g. IMU-only hardware) may not have EMG
  // wired up at all yet. Duplicated into both emgLeft/emgRight when stored
  // in a RepSample below, since that's the shared shape every exercise's
  // session analytics reads and this rig only has one EMG channel.
  const emgBicepLive = hub.pods[1]?.emgActivationPct
  const usingHubEmg = emgBicepLive !== undefined
  const emgBicep = emgBicepLive !== undefined ? Math.round(emgBicepLive) : simulated.emgLeft

  // Target-corridor feedback: pulse the corridor motor for exactly 1 second
  // the instant flexion enters the exercise's target corridor (100°-135° for
  // the default Bicep Curl, a real measured range -- see
  // buildDefaultBicepCurlExercise() in AppDataContext.tsx). Purely
  // edge-triggered — holding inside the
  // corridor doesn't retrigger the buzz — and `corridorPulseActive` (rather
  // than just `inCorridor`) drives the UI so the "Pod X Active" badge tracks
  // the real ~1s motor pulse window instead of however long the arm stays in
  // range.
  const [corridorPulseActive, setCorridorPulseActive] = useState(false)
  const wasInCorridor = useRef(false)
  const corridorPulseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (inCorridor && !wasInCorridor.current) {
      setCorridorPulseActive(true)
      if (corridorPulseTimeoutRef.current) clearTimeout(corridorPulseTimeoutRef.current)
      corridorPulseTimeoutRef.current = setTimeout(() => setCorridorPulseActive(false), HAPTIC_PULSE_MS)
      if (hubConnected) hub.sendHaptic(POD_HAPTIC_CORRIDOR, HAPTIC_PULSE_MS).catch(() => {})
    }
    wasInCorridor.current = inCorridor
  }, [inCorridor, hubConnected, hub])

  // Fault feedback: pulse the second motor the instant a form fault/cheat
  // rep is newly detected — same edge-triggered pattern as the corridor
  // pulse above, on the independent fault motor (Pod 16).
  const [faultPulseActive, setFaultPulseActive] = useState(false)
  const wasFaultActive = useRef(false)
  const faultPulseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (faultActive && !wasFaultActive.current) {
      setFaultPulseActive(true)
      if (faultPulseTimeoutRef.current) clearTimeout(faultPulseTimeoutRef.current)
      faultPulseTimeoutRef.current = setTimeout(() => setFaultPulseActive(false), HAPTIC_PULSE_MS)
      if (hubConnected) hub.sendHaptic(POD_HAPTIC_FAULT, HAPTIC_PULSE_MS).catch(() => {})
    }
    wasFaultActive.current = faultActive
  }, [faultActive, hubConnected, hub])

  useEffect(() => {
    return () => {
      if (corridorPulseTimeoutRef.current) clearTimeout(corridorPulseTimeoutRef.current)
      if (faultPulseTimeoutRef.current) clearTimeout(faultPulseTimeoutRef.current)
    }
  }, [])

  const activeHapticPods = [
    ...(corridorPulseActive ? [POD_HAPTIC_CORRIDOR] : []),
    ...(faultPulseActive ? [POD_HAPTIC_FAULT] : []),
  ]

  // AI form check (ml/'s trained bicep-curl classifier, via the ensemble
  // API's vision-only endpoint — see ensemble/FRONTEND_INTEGRATION.md
  // Section 5): buffer every camera frame's MediaPipe Pose WORLD landmarks
  // while a person is in view, then flush and classify the buffer the
  // instant a rep completes (same repCount-increment boundary repSamples
  // below already uses). Frames buffered here are the same shape the model
  // was trained on regardless of whether the buffer spans one clean rep or
  // some MPU-timed slice of one — the model's own best-window search (see
  // BicepCurlPredictor) handles pacing/tempo variance on the server side.
  const visionFramesRef = useRef<number[][][]>([])
  const visionBufferStartRef = useRef<number | null>(null)
  const [formCheck, setFormCheck] = useState<FormCheckState>({ status: 'idle' })

  function handleWorldLandmarks(landmarks: number[][] | null) {
    if (!landmarks) return
    if (visionBufferStartRef.current === null) visionBufferStartRef.current = performance.now()
    visionFramesRef.current.push(landmarks)
  }

  // Rep-by-rep telemetry: sample the effective angle/EMG the instant each
  // rep completes, so a finished session leaves behind real per-rep data
  // instead of nothing — this is what Session Analytics reads back later.
  const [repSamples, setRepSamples] = useState<RepSample[]>([])
  const prevRepCount = useRef(0)
  useEffect(() => {
    if (repCount > prevRepCount.current) {
      prevRepCount.current = repCount
      setRepSamples((prev) => [
        ...prev,
        { rep: repCount, angle: Math.round(kneeFlexionDeg), emgLeft: emgBicep, emgRight: emgBicep, faultActive },
      ])

      const frames = visionFramesRef.current
      const bufferStart = visionBufferStartRef.current
      visionFramesRef.current = []
      visionBufferStartRef.current = null
      // Always drained, even on the vision-only path below, so a hub that's
      // connected but idle this rep doesn't leak samples into the next one.
      const flexDrift = hub.drainFlexDriftSamples()
      if (bufferStart !== null) {
        // Checked here, before calling predict*, so a too-short buffer (a
        // quick rep, or MediaPipe briefly losing the person mid-movement)
        // shows its own accurate state instead of falling into the same
        // catch as a genuinely unreachable API and being mislabeled "Model
        // Offline" when the API was fine all along.
        if (frames.length < MIN_VISION_FRAMES) {
          setFormCheck({ status: 'insufficient_frames', frameCount: frames.length })
        } else {
          const durationSeconds = (performance.now() - bufferStart) / 1000
          setFormCheck({ status: 'checking' })
          // Real flex/drift from the hub feeds the fused model when
          // connected; otherwise fall back to vision-only, the same as
          // before — see visionModel.ts's module doc for what "fused"
          // actually sends for emg/vib_on (fixed placeholders, not real
          // signals).
          const prediction =
            usingHubCurl && flexDrift.length > 0
              ? predictFusedForm(frames, durationSeconds, flexDrift)
              : predictVisionForm(frames, durationSeconds)
          prediction
            .then((result) => setFormCheck({ status: 'result', result }))
            .catch(() => setFormCheck({ status: 'unavailable' }))
        }
      }
    }
  }, [repCount, kneeFlexionDeg, emgBicep, faultActive, hub, usingHubCurl])

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
            faultThresholdDeg={primaryAngle?.faultThresholdDeg ?? 8}
            onWorldLandmarks={handleWorldLandmarks}
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
              {usingHubCurl
                ? "Flexion, drift and rep counting below are computed live from the ESP32's MPU6050 pods, run through the same curl algorithm as the firmware. The camera feed alongside it feeds AI Form Check."
                : 'No live hub connection right now, so the joint angle and fault state below are simulated from the wearable stream.'}
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
              className={`mt-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${usingHubCurl ? 'bg-accent/10 text-accent' : 'bg-surface-secondary text-ink-faint'}`}
            >
              {usingHubCurl ? 'Source: Live Hub (MPU)' : 'Source: Wearable Simulation'}
            </span>
          </Card>

          <Card className="flex flex-col gap-2.5 p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-ink">AI Form Check</h3>
              <span
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                  formCheck.status === 'result' ? 'bg-accent/10 text-accent' : 'bg-surface-secondary text-ink-faint'
                }`}
              >
                {formCheck.status === 'unavailable' ? 'Model Offline' : usingHubCurl ? 'Vision + Hub' : 'Vision Only'}
              </span>
            </div>

            {formCheck.status === 'idle' && (
              <p className="text-[13px] text-ink-faint">
                Complete a rep in view of the camera to get an AI-scored form check.
              </p>
            )}
            {formCheck.status === 'checking' && (
              <p className="flex items-center gap-2 text-[13px] text-ink-faint">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Scoring your last rep…
              </p>
            )}
            {formCheck.status === 'insufficient_frames' && (
              <p className="text-[13px] text-ink-faint">
                Only saw {formCheck.frameCount} camera frame{formCheck.frameCount === 1 ? '' : 's'} of that rep — not
                enough to score it. Stay fully in frame for the whole movement and it'll pick up next rep.
              </p>
            )}
            {formCheck.status === 'unavailable' && (
              <p className="text-[13px] text-ink-faint">
                Couldn't reach the vision model API — start it with{' '}
                <code className="rounded bg-surface-secondary px-1 py-0.5 text-[12px]">
                  uvicorn ensemble.api.server:app --port 8000
                </code>{' '}
                (see ensemble/README.md).
              </p>
            )}
            {formCheck.status === 'result' &&
              (() => {
                const { result } = formCheck
                const isGoodForm = result.prediction === 'Perfect'
                const isGate =
                  result.prediction === 'no_exercise_detected' ||
                  result.prediction === 'unrecognized_movement' ||
                  result.prediction === 'unrecognized_input'
                return (
                  <>
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-[17px] font-semibold ${isGoodForm ? 'text-emerald' : isGate ? 'text-ink-faint' : 'text-crimson'}`}
                      >
                        {result.prediction ?? 'No result'}
                      </span>
                      {result.good_form_score != null && (
                        <span className="text-[13px] text-ink-faint">
                          {Math.round(result.good_form_score * 100)}% good form
                        </span>
                      )}
                    </div>
                    {result.message && <p className="text-[12px] text-ink-faint">{result.message}</p>}
                    {'source' in result && (
                      <p className="text-[11px] text-ink-faint">source: {result.source}</p>
                    )}
                  </>
                )
              })()}
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
            <EmgActivationBar label="Bicep" value={emgBicep} target={muscleEmgTarget(exercise.muscleEmgTargets, 'right-biceps-brachii')} />
          </Card>

          <Card className="p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-ink">Haptic Biofeedback</h3>
              {activeHapticPods.length > 0 && (
                <span className="flex items-center gap-1.5 text-[13px] font-semibold text-emerald">
                  <Vibrate className="h-3.5 w-3.5" />
                  {activeHapticPods.length > 1 ? `Pods ${activeHapticPods.join(', ')} Active` : `Pod ${activeHapticPods[0]} Active`}
                </span>
              )}
            </div>
            <div>
              <BodyMap pods={PODS} hapticPodId={activeHapticPods.length > 0 ? activeHapticPods : null} height={170} />
            </div>
            <p className="mt-3 text-center text-[13px] text-ink-muted">
              {corridorPulseActive && faultPulseActive
                ? 'Pulsing both motors — corridor reached and a form fault detected'
                : corridorPulseActive
                  ? `Target Corridor Reached — pulsing the corridor motor (Pod ${POD_HAPTIC_CORRIDOR}) for 1s`
                  : faultPulseActive
                    ? `Form Fault Detected — pulsing the fault motor (Pod ${POD_HAPTIC_FAULT}) for 1s`
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
