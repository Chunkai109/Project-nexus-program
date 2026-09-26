import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Activity, Check, RotateCcw, Zap } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { Logo } from '@/components/layout/Logo'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { useAppData } from '@/lib/data/AppDataContext'
import { useBleHub } from '@/lib/ble/BleProvider'
import { PODS } from '@/lib/mockData'
import type { PodId } from '@/types'

/**
 * EMG Baseline & MVC Calibration — implements the normalization routine:
 *   1. Baseline Phase: limb relaxed for 3s, Vbaseline recorded per pod.
 *   2. MVC Phase: maximum voluntary contraction against resistance, Vmvc recorded per pod.
 *   3. Runtime: %Activation = (Vrms - Vbaseline) / (Vmvc - Vbaseline) * 100
 * The third step is already implemented by emgActivationPercent() in ble/protocol.ts;
 * this page's job is to capture per-patient Vbaseline/Vmvc and hand them to BleProvider.
 */

const PHASE_DURATION_MS = 3000
const SAMPLE_INTERVAL_MS = 100

type Phase = 'idle' | 'baseline' | 'baseline-done' | 'mvc' | 'mvc-done'

const EMG_PODS = PODS.filter((p) => p.kind === 'EMG+IMU')

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
  const hub = useBleHub()
  const hubConnected = hub.connectionState === 'connected'

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
        const raw = hubConnected
          ? (hub.pods[pod.id]?.vrmsRaw ?? 0)
          : simulateRawSample(phase, elapsedSec, pod.id)
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
  }, [phase, hubConnected, hub.pods])

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
  const isActivePhase = phase === 'baseline' || phase === 'mvc'

  return (
    <PageShell>
      <header className="translucent-header sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-6 lg:px-10 lg:py-4">
        <Logo size="sm" />
        <Breadcrumb
          steps={[{ label: 'Step 1: Sensor Placement' }, { label: 'Step 2: Calibration' }, { label: 'Step 3: Live Session' }]}
          activeIndex={1}
        />
        <ThemeToggle />
      </header>

      <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-10">
        <Card className="p-7">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-[17px] font-semibold text-ink">EMG Baseline &amp; MVC Calibration</h1>
            <span
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${hubConnected ? 'bg-emerald/10 text-emerald' : 'bg-surface-secondary text-ink-faint'}`}
            >
              {hubConnected ? 'Source: Live Hub' : 'Source: Wearable Simulation'}
            </span>
          </div>
          <p className="text-[13px] text-ink-faint">{exercise.title}</p>
          <p className="mt-4 text-[13px] leading-relaxed text-ink-muted">
            Muscle placement and individual physiology change what a raw EMG reading means, so every session starts by
            recording your own baseline and maximum contraction. Runtime activation is then measured as{' '}
            <span className="font-medium text-ink">(V_rms − V_baseline) / (V_mvc − V_baseline) × 100%</span> for each pod.
          </p>
        </Card>

        {phase === 'idle' && (
          <Card className="flex flex-col items-center gap-4 p-10 text-center">
            <Activity className="h-8 w-8 text-accent" />
            <div>
              <p className="text-[15px] font-medium text-ink">Ready to calibrate</p>
              <p className="mt-1 max-w-sm text-[13px] text-ink-faint">
                First you'll relax your leg completely for 3 seconds, then push against resistance as hard as you can for
                3 seconds.
              </p>
            </div>
            <Button size="lg" onClick={startBaseline}>
              <Zap className="h-4 w-4" />
              Begin Baseline Phase
            </Button>
          </Card>
        )}

        {isActivePhase && (
          <Card className="flex flex-col items-center gap-6 p-10 text-center">
            <p className="text-[15px] font-semibold text-ink">
              {phase === 'baseline' ? 'Relax your leg completely' : 'Push against resistance — maximum effort!'}
            </p>
            <div className="flex h-24 w-24 items-center justify-center rounded-full bg-accent/10">
              <span className="text-4xl font-semibold tabular-nums text-accent">{remainingSec}</span>
            </div>
            <div className="flex w-full flex-col gap-4">
              {EMG_PODS.map((pod) => (
                <div key={pod.id} className="text-left">
                  <div className="mb-1.5 flex items-center justify-between text-[13px]">
                    <span className="font-medium text-ink">{pod.location}</span>
                    <span className="text-ink-faint">{((liveByPod[pod.id] ?? 0) * 100).toFixed(0)}%</span>
                  </div>
                  <ProgressBar value={(liveByPod[pod.id] ?? 0) * 100} tone={phase === 'mvc' ? 'crimson' : 'accent'} />
                </div>
              ))}
            </div>
          </Card>
        )}

        {phase === 'baseline-done' && (
          <Card className="flex flex-col items-center gap-5 p-10 text-center">
            <Check className="h-8 w-8 text-emerald" />
            <div>
              <p className="text-[15px] font-medium text-ink">Baseline captured</p>
              <div className="mt-3 flex flex-col gap-1.5">
                {EMG_PODS.map((pod) => (
                  <p key={pod.id} className="text-[13px] text-ink-muted">
                    {pod.location}: <span className="font-medium text-ink">{(baselineByPod[pod.id] ?? 0).toFixed(3)}</span>
                  </p>
                ))}
              </div>
              <p className="mt-3 max-w-sm text-[13px] text-ink-faint">
                Now push against resistance as hard as you can for 3 seconds to record your maximum contraction.
              </p>
            </div>
            <Button size="lg" onClick={startMvc}>
              <Zap className="h-4 w-4" />
              Begin MVC Phase
            </Button>
          </Card>
        )}

        {phase === 'mvc-done' && (
          <Card className="flex flex-col gap-5 p-8">
            <div className="flex items-center gap-2 text-emerald">
              <Check className="h-5 w-5" />
              <p className="text-[15px] font-semibold text-ink">Calibration complete</p>
            </div>
            <div className="flex flex-col gap-3">
              {EMG_PODS.map((pod) => {
                const baseline = baselineByPod[pod.id] ?? 0
                const mvc = mvcByPod[pod.id] ?? 0
                return (
                  <div key={pod.id} className="rounded-xl bg-surface-secondary p-4">
                    <p className="mb-2 text-[13px] font-medium text-ink">{pod.location}</p>
                    <div className="grid grid-cols-3 gap-3 text-center">
                      <div>
                        <p className="text-[11px] uppercase tracking-wide text-ink-faint">Baseline</p>
                        <p className="text-[15px] font-semibold text-ink">{baseline.toFixed(3)}</p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-wide text-ink-faint">MVC</p>
                        <p className="text-[15px] font-semibold text-ink">{mvc.toFixed(3)}</p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-wide text-ink-faint">Range</p>
                        <p className="text-[15px] font-semibold text-accent">{(mvc - baseline).toFixed(3)}</p>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="flex gap-3">
              <Button variant="ghost" onClick={recalibrate}>
                <RotateCcw className="h-4 w-4" />
                Recalibrate
              </Button>
              <Button className="flex-1" onClick={confirmAndContinue}>
                <Check className="h-4 w-4" />
                Confirm &amp; Continue
              </Button>
            </div>
          </Card>
        )}
      </main>
    </PageShell>
  )
}
