import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, TriangleAlert, Timer, Repeat, ScanEye, Loader2, ChevronDown, ChevronUp } from 'lucide-react'
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
  | { status: 'capturing'; phase: 'rising' | 'settling' }
  | { status: 'checking' }
  | { status: 'result'; result: VisionPrediction | FusedPrediction }
  | { status: 'insufficient_frames'; frameCount: number }
  | { status: 'unavailable' }

// Degrees of genuine movement required before the vision-capture window
// reacts to it — filters out sensor jitter so a 1-2 degree wobble at rest
// (or at the top of a rep) never looks like "started rising"/"started
// rising again". Reused for both the start-of-rise check and the
// post-corridor re-rise check below, and doubles as the plateau tolerance
// (see SETTLE_WINDOW_MS) since both are "is this actually moving?" checks
// on the same signal.
const RISE_THRESHOLD_DEG = 10

// How long flexion has to stay within RISE_THRESHOLD_DEG of itself, once the
// corridor has been reached at least once, before that stillness counts as
// "settled" and ends the capture window. 1s is long enough that ordinary
// between-sample jitter doesn't trigger it prematurely, short enough that a
// genuine hold at the top isn't kept waiting.
const SETTLE_WINDOW_MS = 1000

// Dummy EMG is derived from flexion itself rather than its own independent
// wave, so it rises as the arm curls up, peaks at full contraction, and
// drops again as it extends back down -- same shape a real bicep's EMG
// activation roughly follows through a curl. Normalized against this rig's
// real calibrated flexion range (0deg = full extension, 135deg = full
// contraction -- the same range EXTENSION_LIMIT/CONTRACTION_LIMIT/the
// RadialGauge's default target are all keyed to), not the exercise's own
// configurable target corridor, so it behaves the same regardless of what
// target zone a physio has prescribed.
const EMG_FLEX_REST_DEG = 0
const EMG_FLEX_PEAK_DEG = 135

/** Maps a flexion angle to a dummy %MVC that rises/peaks/falls with it, plus a little noise since a perfectly smooth signal would look obviously fake. */
function emgFromFlexion(flexDeg: number): number {
  const t = (flexDeg - EMG_FLEX_REST_DEG) / (EMG_FLEX_PEAK_DEG - EMG_FLEX_REST_DEG)
  const pct = Math.max(0, Math.min(1, t)) * 100
  const noise = (Math.random() - 0.5) * 4
  return Math.round(Math.max(0, Math.min(100, pct + noise)))
}

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

  // Rep counting: the full condition for a rep is the same rise -> corridor
  // -> settle/re-rise cycle the vision-capture window below tracks, so a rep
  // is counted at the exact moment that cycle completes (see the "if
  // (settled || risingAgain || fellToRest)" block further down) -- not at
  // the rise that merely starts an attempt. An attempt that never reaches
  // the corridor (an aborted lift, see the belowRest branch below) is not
  // counted at all: the full condition was never satisfied. Passing the
  // AI's form check is still a separate, informational signal (the AI Form
  // Check card) that never gates counting -- a rep can count and still be
  // scored poor form. Works identically whether flex comes from the real
  // hub or the wearable simulator, since both already funnel into the same
  // kneeFlexionDeg above. prevRepCount is the authoritative synchronous
  // counter (repCount state is just its rendered mirror, for the header).
  const [repCount, setRepCount] = useState(0)
  const prevRepCount = useRef(0)

  // EMG always comes from emgFromFlexion(), tracking the current flexion
  // angle directly -- the real EMG pod's reading is deliberately never
  // checked here (explicit request: the live pod wasn't working reliably,
  // so EMG was decoupled from it entirely rather than keep debugging the
  // live path), and it's no longer sourced from the wearable simulator's
  // own independent EMG wave either (also an explicit request: dummy EMG
  // should rise/peak/fall with flexion, not run on its own unrelated
  // cycle). Duplicated into both emgLeft/emgRight when stored in a
  // RepSample below, since that's the shared shape every exercise's
  // session analytics reads and this rig only has one EMG channel.
  const usingHubEmg = false
  const emgBicep = emgFromFlexion(kneeFlexionDeg)

  // AI form check (ml/'s trained bicep-curl classifier, via the ensemble
  // API's vision-only endpoint — see ensemble/FRONTEND_INTEGRATION.md
  // Section 5): buffer MediaPipe Pose WORLD landmarks for exactly one rep's
  // motion, bounded by real movement rather than a fixed frame count or a
  // single instant:
  //  - STARTS once flexion has climbed RISE_THRESHOLD_DEG above the lowest
  //    point it's rested at (angleLocalMinRef) -- not the instant it ticks
  //    upward at all, so ordinary sensor jitter while resting never counts
  //    as "started rising". angleLocalMinRef tracks a plain running minimum
  //    while not capturing, so this also works for someone doing
  //    partial-range reps that never touch true full extension: the
  //    baseline just becomes wherever their own bottom actually is.
  //  - Once flexion reaches the corridor, the window doesn't end there —
  //    it keeps recording (postCorridorRef true) until ANY of:
  //      (a) flexion has stayed within RISE_THRESHOLD_DEG of itself for a
  //          full SETTLE_WINDOW_MS (a genuine hold/plateau -- angleHistoryRef
  //          is the trailing ~1s of samples this checks),
  //      (b) flexion genuinely falls RISE_THRESHOLD_DEG off its post-corridor
  //          peak and then climbs RISE_THRESHOLD_DEG again (a real
  //          down-then-up bounce -- see postCorridorPeakRef's own comment for
  //          why "climbed at all since touching the corridor" isn't enough),
  //      (c) flexion falls all the way back to full extension (a safety net:
  //          fast back-to-back reps with no pause anywhere could otherwise
  //          never satisfy (a) or (b) and capture indefinitely).
  // visionCapturingRef gates handleWorldLandmarks below so frames outside
  // an active window (resting, or descending after a completed rep) are
  // never buffered at all.
  const visionCapturingRef = useRef(false)
  const angleLocalMinRef = useRef(Infinity)
  const postCorridorRef = useRef(false)
  // "Rising again" (below) has to mean a genuine down-then-up bounce, not
  // just continued upward motion toward the rep's own natural peak — flexion
  // keeps climbing for a while after first touching the corridor (the
  // corridor's floor isn't the top of the rep), and treating that ordinary
  // continued rise as "rising again" flushed the window within milliseconds
  // of ever reaching the corridor, before any real hold could register. So
  // this tracks the post-corridor peak, waits for flexion to actually fall
  // RISE_THRESHOLD_DEG off that peak (postCorridorDescendedRef flips true),
  // and only then treats a further RISE_THRESHOLD_DEG climb off the
  // post-descent low as "rising again".
  const postCorridorPeakRef = useRef(-Infinity)
  const postCorridorDescendedRef = useRef(false)
  const postCorridorMinAfterDescentRef = useRef(Infinity)
  const angleHistoryRef = useRef<{ t: number; angle: number }[]>([])
  const visionFramesRef = useRef<number[][][]>([])
  const visionBufferStartRef = useRef<number | null>(null)
  const [formCheck, setFormCheck] = useState<FormCheckState>({ status: 'idle' })
  const [formCheckExpanded, setFormCheckExpanded] = useState(true)

  function handleWorldLandmarks(landmarks: number[][] | null) {
    if (!landmarks || !visionCapturingRef.current) return
    visionFramesRef.current.push(landmarks)
  }

  // Rep-by-rep telemetry: sample the effective angle/EMG the instant each
  // rep completes, so a finished session leaves behind real per-rep data
  // instead of nothing — this is what Session Analytics reads back later.
  const [repSamples, setRepSamples] = useState<RepSample[]>([])

  useEffect(() => {
    const now = performance.now()
    const belowRest = kneeFlexionDeg < EXTENSION_LIMIT

    if (!visionCapturingRef.current) {
      angleLocalMinRef.current = Math.min(angleLocalMinRef.current, kneeFlexionDeg)
      if (kneeFlexionDeg - angleLocalMinRef.current >= RISE_THRESHOLD_DEG) {
        visionCapturingRef.current = true
        postCorridorRef.current = false
        visionFramesRef.current = []
        visionBufferStartRef.current = now
        angleHistoryRef.current = [{ t: now, angle: kneeFlexionDeg }]
        hub.drainFlexDriftSamples() // discard anything from before this rise began
        setFormCheck({ status: 'capturing', phase: 'rising' })
      }
      return
    }

    angleHistoryRef.current.push({ t: now, angle: kneeFlexionDeg })
    while (angleHistoryRef.current.length > 1 && now - angleHistoryRef.current[0].t > SETTLE_WINDOW_MS) {
      angleHistoryRef.current.shift()
    }

    if (!postCorridorRef.current) {
      if (inCorridor) {
        postCorridorRef.current = true
        postCorridorPeakRef.current = kneeFlexionDeg
        postCorridorDescendedRef.current = false
        postCorridorMinAfterDescentRef.current = Infinity
        setFormCheck({ status: 'capturing', phase: 'settling' })
      } else if (belowRest) {
        // Dropped back to full extension without ever reaching the
        // corridor — the full rep condition (rise -> corridor ->
        // settle/re-rise) was never satisfied, so this attempt is not
        // counted at all, and its frames are discarded rather than scored.
        visionCapturingRef.current = false
        visionFramesRef.current = []
        visionBufferStartRef.current = null
        hub.drainFlexDriftSamples()
        setFormCheck({ status: 'idle' })
      }
      return
    }

    postCorridorPeakRef.current = Math.max(postCorridorPeakRef.current, kneeFlexionDeg)
    if (!postCorridorDescendedRef.current) {
      if (postCorridorPeakRef.current - kneeFlexionDeg >= RISE_THRESHOLD_DEG) {
        postCorridorDescendedRef.current = true
        postCorridorMinAfterDescentRef.current = kneeFlexionDeg
      }
    } else {
      postCorridorMinAfterDescentRef.current = Math.min(postCorridorMinAfterDescentRef.current, kneeFlexionDeg)
    }

    const history = angleHistoryRef.current
    const spanMs = now - history[0].t
    const maxAngle = Math.max(...history.map((s) => s.angle))
    const minAngle = Math.min(...history.map((s) => s.angle))
    const settled = spanMs >= SETTLE_WINDOW_MS && maxAngle - minAngle <= RISE_THRESHOLD_DEG
    const risingAgain =
      postCorridorDescendedRef.current && kneeFlexionDeg - postCorridorMinAfterDescentRef.current >= RISE_THRESHOLD_DEG
    // Safety net beyond the two conditions above: with fast, back-to-back
    // reps and no real pause anywhere (not at the top, not at the bottom),
    // neither settled nor risingAgain is guaranteed to ever fire, and the
    // window would otherwise capture indefinitely, bleeding into later reps.
    // A full return to full extension always means this rep's motion is
    // over regardless of what its velocity profile looked like on the way
    // there, so it closes the window unconditionally.
    const fellToRest = belowRest

    if (settled || risingAgain || fellToRest) {
      // This is the full condition for a rep: it rose at least
      // RISE_THRESHOLD_DEG, reached the corridor (postCorridorRef only gets
      // here once that happened), and has now either settled, started
      // rising again, or fallen back to rest -- count it right here, at
      // completion, not at the rise that merely started the attempt.
      prevRepCount.current += 1
      const thisRep = prevRepCount.current
      setRepCount(thisRep)
      setRepSamples((prev) => [
        ...prev,
        { rep: thisRep, angle: Math.round(kneeFlexionDeg), emgLeft: emgBicep, emgRight: emgBicep, faultActive },
      ])

      const frames = visionFramesRef.current
      visionFramesRef.current = []
      const flexDrift = hub.drainFlexDriftSamples()
      const bufferStart = visionBufferStartRef.current
      visionBufferStartRef.current = null
      visionCapturingRef.current = false
      angleLocalMinRef.current = kneeFlexionDeg // fresh baseline for the next rise

      if (bufferStart !== null) {
        if (frames.length < MIN_VISION_FRAMES) {
          // The rep happened faster than the camera could keep up with —
          // a real possibility now that the window is scoped to one lift
          // instead of accumulating across several. Reported per-rep
          // rather than silently carried into the next window, since a
          // carried-over window would no longer represent a single rep.
          setFormCheck({ status: 'insufficient_frames', frameCount: frames.length })
        } else {
          const durationSeconds = (now - bufferStart) / 1000
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
  }, [kneeFlexionDeg, inCorridor, emgBicep, faultActive, hub, usingHubCurl])

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
            <button
              type="button"
              onClick={() => setFormCheckExpanded((v) => !v)}
              className="flex items-center justify-between text-left"
              aria-expanded={formCheckExpanded}
            >
              <h3 className="text-[15px] font-semibold text-ink">AI Form Check</h3>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                    formCheck.status === 'result' ? 'bg-accent/10 text-accent' : 'bg-surface-secondary text-ink-faint'
                  }`}
                >
                  {formCheck.status === 'unavailable' ? 'Model Offline' : usingHubCurl ? 'Vision + Hub' : 'Vision Only'}
                </span>
                {formCheckExpanded ? (
                  <ChevronUp className="h-4 w-4 flex-shrink-0 text-ink-faint" />
                ) : (
                  <ChevronDown className="h-4 w-4 flex-shrink-0 text-ink-faint" />
                )}
              </div>
            </button>

            {formCheckExpanded && (
              <>
                {formCheck.status === 'idle' && (
                  <p className="text-[13px] text-ink-faint">
                    Start curling from full extension in view of the camera to get an AI-scored form check.
                  </p>
                )}
                {formCheck.status === 'capturing' && (
                  <p className="flex items-center gap-2 text-[13px] text-ink-faint">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {formCheck.phase === 'rising'
                      ? 'Recording this rep — keep going to the target…'
                      : 'In the target zone — hold briefly to finish scoring this rep…'}
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
              </>
            )}
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
