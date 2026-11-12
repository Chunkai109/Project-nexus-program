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

  useEffect(() => {
    if (phase !== 'baseline' && phase !== 'mvc') return
    samplesRef.current = {}
    for (const pod of EMG_PODS) samplesRef.current[pod.id] = []
    const startedAt = performance.now()

    const interval = setInterval(() => {
      const elapsedSec = (performance.now() - startedAt) / 1000
      const nextLive: Partial<Record<PodId, number>> = {}
      for (const pod of EMG_PODS) {
        const raw = simulateRawSample(phase, elapsedSec, pod.id)
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

  function startBaseline() {
    setRemainingMs(PHASE_DURATION_MS)
    setPhase('baseline')
  }

  function startMvc() {
    setRemainingMs(PHASE_DURATION_MS)
    setPhase('mvc')
  }

  function recalibrate() {
    setBaselineByPod({})
    setMvcByPod({})
    setLiveByPod({})
    setPhase('idle')
  }

  function confirmAndContinue() {
    if (!exercise) return
    for (const pod of EMG_PODS) {
      const baseline = baselineByPod[pod.id] ?? 0.08
      const mvcRaw = mvcByPod[pod.id] ?? 1.0
      const mvc = mvcRaw > baseline ? mvcRaw : baseline + 0.1
      hub.setCalibration(pod.id, { baseline, mvc })
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
    <PageShell>
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
