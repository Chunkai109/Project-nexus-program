import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { Button } from '@/components/ui/Button'
import { CalibrationView } from '@/components/patient/CalibrationView'
import { useAppData } from '@/lib/data/AppDataContext'
import { useSensorHub } from '@/lib/hub/HubProvider'
import { CURL_FLEX_POD_ID } from '@/lib/hub/bicepCurlCounter'
import { PODS } from '@/lib/mockData'
import type { PodId } from '@/types'

/**
 * EMG Baseline & MVC Calibration — implements the normalization routine:
 *   1. Baseline Phase: limb relaxed for 3s, Vbaseline recorded per pod.
 *   2. MVC Phase: maximum voluntary contraction against resistance, Vmvc recorded per pod.
 *   3. Runtime: %Activation = (Vrms - Vbaseline) / (Vmvc - Vbaseline) * 100
 * The third step is already implemented by emgActivationPercent() in hub/protocol.ts;
 * this page's job is to capture per-patient Vbaseline/Vmvc and hand them to HubProvider.
 */

const PHASE_DURATION_MS = 3000
const SAMPLE_INTERVAL_MS = 100

type Phase = 'idle' | 'baseline' | 'baseline-done' | 'mvc' | 'mvc-done'

const EMG_PODS = PODS.filter((p) => p.kind === 'EMG' || p.kind === 'EMG+IMU')

function simulateRawSample(phase: 'baseline' | 'mvc', elapsedSec: number, seed: number): number {
  const noise = (Math.sin((elapsedSec + seed) * 13) + Math.sin((elapsedSec + seed) * 7)) * 0.012
  if (phase === 'baseline') return Math.max(0, 0.06 + noise)
  const ramp = Math.min(1, elapsedSec / 1.2)
  return Math.max(0, 0.88 * ramp + noise)
}

export function CalibrationPage() {
  const { exerciseId } = useParams()
  const navigate = useNavigate()
  const { exercises } = useAppData()
  const exercise = useMemo(() => exercises.find((e) => e.id === exerciseId) ?? null, [exercises, exerciseId])
  const hub = useSensorHub()

  const [phase, setPhase] = useState<Phase>('idle')
  const [remainingMs, setRemainingMs] = useState(PHASE_DURATION_MS)
  const [liveByPod, setLiveByPod] = useState<Partial<Record<PodId, number>>>({})
  const [baselineByPod, setBaselineByPod] = useState<Partial<Record<PodId, number>>>({})
  const [mvcByPod, setMvcByPod] = useState<Partial<Record<PodId, number>>>({})
  const samplesRef = useRef<Partial<Record<PodId, number[]>>>({})
  // Whether this step reads the real muscle sensor: the hub is connected and Pod 1 is sending EMG.
  // Fixed when a step starts, so one step never mixes real and simulated samples.
  // Real sEMG readings are switched off for now: the effort step always uses the simulated reading.
  const emgLive = false
  const [emgSource, setEmgSource] = useState<'hub' | 'simulated'>('simulated')
  const useRealRef = useRef(false)
  const podsRef = useRef(hub.pods)
  useEffect(() => {
    podsRef.current = hub.pods
  }, [hub.pods])

  useEffect(() => {
    if (phase !== 'baseline' && phase !== 'mvc') return
    samplesRef.current = {}
    for (const pod of EMG_PODS) samplesRef.current[pod.id] = []
    const startedAt = performance.now()

    const interval = setInterval(() => {
      const elapsedSec = (performance.now() - startedAt) / 1000
      const nextLive: Partial<Record<PodId, number>> = {}
      for (const pod of EMG_PODS) {
        // Real sEMG envelope from the hub when it is streaming; simulated otherwise (and labelled so on screen).
        const real = podsRef.current[pod.id]?.vrmsRaw
        const raw = useRealRef.current && real !== undefined ? real : simulateRawSample(phase, elapsedSec, pod.id)
        samplesRef.current[pod.id]?.push(raw)
        nextLive[pod.id] = raw
      }
      setLiveByPod(nextLive)
      setRemainingMs(Math.max(0, PHASE_DURATION_MS - (performance.now() - startedAt)))
    }, SAMPLE_INTERVAL_MS)

    const timeout = setTimeout(() => {
      clearInterval(interval)
      const results: Partial<Record<PodId, number>> = {}
      for (const pod of EMG_PODS) {
        const samples = samplesRef.current[pod.id] ?? []
        results[pod.id] =
          phase === 'baseline'
            ? samples.reduce((sum, v) => sum + v, 0) / Math.max(1, samples.length)
            : Math.max(0, ...samples)
      }
      if (phase === 'baseline') {
        setBaselineByPod(results)
        setPhase('baseline-done')
      } else {
        setMvcByPod(results)
        setPhase('mvc-done')
      }
    }, PHASE_DURATION_MS)

    return () => {
      clearInterval(interval)
      clearTimeout(timeout)
    }
  }, [phase])

  if (!exercise) {
    return (
      <PageShell fullWidth>
        <main className="flex min-h-app flex-col items-center justify-center gap-4 px-6 text-center">
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

  function startBaseline() {
    useRealRef.current = emgLive
    setEmgSource(emgLive ? 'hub' : 'simulated')
    setRemainingMs(PHASE_DURATION_MS)
    setPhase('baseline')
  }

  function startMvc() {
    // Step 2 uses the same source as step 1, so resting and firm are comparable.
    setRemainingMs(PHASE_DURATION_MS)
    setPhase('mvc')
  }

  function recalibrate() {
    setBaselineByPod({})
    setMvcByPod({})
    setLiveByPod({})
    useRealRef.current = false
    setPhase('idle')
  }

  function confirmAndContinue() {
    if (!exercise) return
    // Only a real reading of both steps calibrates the muscle sensor. Without it, Live keeps
    // muscle effort simulated (and says so) rather than scaling real readings with made-up values.
    if (phase === 'mvc-done' && emgSource === 'hub') {
      for (const pod of EMG_PODS) {
        const baseline = baselineByPod[pod.id]
        const mvcRaw = mvcByPod[pod.id]
        if (baseline === undefined || mvcRaw === undefined) continue
        // A firm reading no higher than resting can't scale anything; keep a small usable gap.
        const mvc = mvcRaw > baseline ? mvcRaw : baseline + 0.01
        hub.setCalibration(pod.id, { baseline, mvc })
      }
    }
    navigate(`/patient/session/${exercise.id}`)
  }

  const remainingSec = Math.ceil(remainingMs / 1000)
  const hubConnected = hub.connectionState === 'connected'
  // Read-only: the real forearm angle, to show the patient the rig is reading their arm.
  const liveAngle = hubConnected ? (hub.pods[CURL_FLEX_POD_ID]?.pitchDeg ?? null) : null
  const target = exercise.angleConfigs[0]
  const liveValues = EMG_PODS.map((pod) => liveByPod[pod.id] ?? 0)
  const liveEffortPct = liveValues.length === 0 ? 0 : (liveValues.reduce((sum, v) => sum + v, 0) / liveValues.length) * 100
  const results =
    phase === 'mvc-done'
      ? EMG_PODS.map((pod) => ({ label: pod.label, baseline: baselineByPod[pod.id] ?? 0, mvc: mvcByPod[pod.id] ?? 0 }))
      : []

  return (
    <PageShell fullWidth>
      <CalibrationView
        exerciseTitle={exercise.title}
        hubConnected={hubConnected}
        liveAngle={liveAngle}
        targetMin={target?.targetMin ?? 100}
        targetMax={target?.targetMax ?? 135}
        phase={phase}
        remainingSec={remainingSec}
        liveEffortPct={liveEffortPct}
        results={results}
        onStartBaseline={startBaseline}
        onStartMvc={startMvc}
        onRecalibrate={recalibrate}
        onBack={() => navigate(`/patient/setup/${exercise.id}`)}
        onContinue={confirmAndContinue}
      />
    </PageShell>
  )
}
