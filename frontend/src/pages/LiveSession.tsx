import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, TriangleAlert, Timer, Repeat, ScanEye, Loader2 } from 'lucide-react'
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
import { useSensorStream } from '@/lib/useSensorStream'
import { useAppData } from '@/lib/data/AppDataContext'
import { useAuth } from '@/lib/AuthContext'
import { muscleEmgTarget } from '@/lib/muscles'
import { useSensorHub } from '@/lib/hub/HubProvider'
import { CURL_DRIFT_POD_ID, CURL_FLEX_POD_ID, EXTENSION_LIMIT } from '@/lib/hub/bicepCurlCounter'
import { predictVisionForm, predictFusedForm, MIN_VISION_FRAMES, type VisionPrediction, type FusedPrediction } from '@/lib/visionModel'
import type { RepSample } from '@/types'

// MediaPipe camera-based pose detection — was a hardcoded-off testing flag
// to isolate the hub's MPU-only rep counter; now on by default so the
// camera actually feeds the trained vision model (see the world-landmarks
// buffering below and ensemble/FRONTEND_INTEGRATION.md Section 5). Flip
// back to false to go back to testing MPU-only, camera-disabled.
const ENABLE_MEDIAPIPE_VISION = true

type FormCheckState =
  | { status: 'idle' }
  | { status: 'capturing' }
  | { status: 'checking' }
  | { status: 'result'; result: VisionPrediction | FusedPrediction }
  | { status: 'insufficient_frames'; frameCount: number }
  | { status: 'unavailable' }

/** Builds the human-readable verdict stored per-rep for Session Summary's "AI Form Check Notes" (see SessionSummary.tsx). */
function describeAiResult(result: VisionPrediction | FusedPrediction): string {
  const prediction = result.prediction ?? 'No result'
  const score = result.good_form_score != null ? ` (${Math.round(result.good_form_score * 100)}% good form)` : ''
  const message = result.message ? ` — ${result.message}` : ''
  return `${prediction}${score}${message}`
}

export function LiveSession() {
  const { exerciseId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { exercises, patients, recordSession } = useAppData()
  const exercise = useMemo(() => exercises.find((e) => e.id === exerciseId) ?? null, [exercises, exerciseId])
  const [ending, setEnding] = useState(false)
  const hub = useSensorHub()

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

  const targetMin = primaryAngle?.targetMin ?? simulated.targetMin
  const targetMax = primaryAngle?.targetMax ?? simulated.targetMax
  const inCorridor = kneeFlexionDeg >= targetMin && kneeFlexionDeg <= targetMax

  // Rep counting: every time flexion enters the target corridor, count it —
  // full stop. Deliberately does NOT consider form/posture/drift-fault
  // detection at all (an explicit product decision, not an oversight): the
  // AI Form Check and the fault badge above remain separate, informational
  // signals that never gate counting. Edge-triggered on corridor entry
  // (holding inside it doesn't add extra reps), and works identically
  // whether flex comes from the real hub or the wearable simulator, since
  // both already funnel into the same kneeFlexionDeg/inCorridor above.
  const [repCount, setRepCount] = useState(0)
  const wasInCorridor = useRef(false)

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

  // AI form check (ml/'s trained bicep-curl classifier, via the ensemble
  // API's vision-only endpoint — see ensemble/FRONTEND_INTEGRATION.md
  // Section 5): buffer MediaPipe Pose WORLD landmarks for exactly the
  // concentric phase of a rep — from the instant flexion leaves full
  // extension (below EXTENSION_LIMIT) and starts rising, to the instant it
  // reaches the target corridor — then classify that window. A fixed frame
  // count doesn't correspond to any real phase of the movement; this does,
  // so what gets scored is always "this one lift", never a few frames of one
  // rep glued to a few frames of the next. visionCapturingRef gates
  // handleWorldLandmarks below so frames outside the window (resting at the
  // bottom, or descending back down after a rep) are never buffered at all.
  const visionCapturingRef = useRef(false)
  const hasRestedRef = useRef(true) // starts true: a session begins at rest
  const visionFramesRef = useRef<number[][][]>([])
  const visionBufferStartRef = useRef<number | null>(null)
  const [formCheck, setFormCheck] = useState<FormCheckState>({ status: 'idle' })

  function handleWorldLandmarks(landmarks: number[][] | null) {
    if (!landmarks || !visionCapturingRef.current) return
    visionFramesRef.current.push(landmarks)
  }

  // Rep-by-rep telemetry: sample the effective angle/EMG the instant each
  // rep completes, so a finished session leaves behind real per-rep data
  // instead of nothing — this is what Session Analytics reads back later.
  const [repSamples, setRepSamples] = useState<RepSample[]>([])
  const prevRepCount = useRef(0)

  useEffect(() => {
    const belowRest = kneeFlexionDeg < EXTENSION_LIMIT
    if (belowRest) hasRestedRef.current = true

    if (!visionCapturingRef.current && hasRestedRef.current && !belowRest && !inCorridor) {
      // Flexion just left full extension and is climbing toward the
      // corridor — start this rep's capture window right here. Requiring
      // hasRestedRef (only set once the arm is confirmed fully extended,
      // and cleared the moment a capture starts) stops this from
      // re-triggering on the way back down out of the corridor for someone
      // doing partial-range reps that never bottom out.
      visionCapturingRef.current = true
      hasRestedRef.current = false
      visionFramesRef.current = []
      visionBufferStartRef.current = performance.now()
      hub.drainFlexDriftSamples() // discard anything from before this rise began
      setFormCheck({ status: 'capturing' })
    } else if (visionCapturingRef.current && belowRest) {
      // Dropped back to full extension without ever reaching the corridor —
      // an aborted lift. Discard rather than scoring a partial attempt.
      visionCapturingRef.current = false
      visionFramesRef.current = []
      visionBufferStartRef.current = null
      hub.drainFlexDriftSamples()
      setFormCheck({ status: 'idle' })
    }

    if (inCorridor && !wasInCorridor.current) {
      setRepCount((c) => c + 1)
    }
    wasInCorridor.current = inCorridor
  }, [kneeFlexionDeg, inCorridor, hub])

  useEffect(() => {
    if (repCount > prevRepCount.current) {
      const thisRep = repCount
      prevRepCount.current = repCount
      setRepSamples((prev) => [
        ...prev,
        { rep: thisRep, angle: Math.round(kneeFlexionDeg), emgLeft: emgBicep, emgRight: emgBicep, faultActive },
      ])

      // This rep's capture window (started the moment flexion left full
      // extension, above) just ended by reaching the corridor — flush
      // exactly that window, not an accumulated multi-rep buffer.
      visionCapturingRef.current = false
      const frames = visionFramesRef.current
      visionFramesRef.current = []
      const flexDrift = hub.drainFlexDriftSamples()
      const bufferStart = visionBufferStartRef.current
      visionBufferStartRef.current = null

      if (bufferStart !== null) {
        if (frames.length < MIN_VISION_FRAMES) {
          // The rep's rise happened faster than the camera could keep up
          // with — a real possibility now that the window is scoped to one
          // lift instead of accumulating across several. Reported per-rep
          // rather than silently carried into the next window, since a
          // carried-over window would no longer represent a single rep.
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
            .then((result) => {
              setFormCheck({ status: 'result', result })
              const comment = describeAiResult(result)
              setRepSamples((prev) => prev.map((r) => (r.rep === thisRep ? { ...r, aiComment: comment } : r)))
            })
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
            faultActive={faultActive}
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
            <p className="mt-3 text-center text-[13px] font-medium text-ink-muted">
              {kneeFlexionDeg < targetMin ? 'Keep going!' : 'Nice — target reached!'}
            </p>
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
                Start curling from full extension in view of the camera to get an AI-scored form check.
              </p>
            )}
            {formCheck.status === 'capturing' && (
              <p className="flex items-center gap-2 text-[13px] text-ink-faint">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Recording this rep — keep going to the target…
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
                That rep was too fast for the camera to score (only {formCheck.frameCount} frame
                {formCheck.frameCount === 1 ? '' : 's'} captured) — try pacing the lift a little slower.
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

          <Button variant="danger" size="lg" className="w-full" onClick={handleEnd} disabled={ending}>
            {ending ? 'Syncing session data…' : 'End Session & Sync Data'}
          </Button>
        </div>
      </main>
    </PageShell>
  )
}
