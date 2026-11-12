import { useState } from 'react'
import { ArrowLeft, ArrowRight, CheckCircle2, Circle, RotateCcw } from 'lucide-react'
import { clsx } from 'clsx'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { SessionHeader } from './PatientHeader'
import { Details, SimulatedTag, StatusLabel } from './PatientBits'

export type EffortPhase = 'idle' | 'baseline' | 'baseline-done' | 'mvc' | 'mvc-done'

/**
 * PLACEHOLDER until a physiotherapist confirms it: how close to 0° the
 * straight-arm reading must be to count as "reading correctly".
 */
export const STRAIGHT_TOLERANCE_DEG = 10

function CheckRow({ done, title, detail }: { done: boolean; title: string; detail: string }) {
  return (
    <li className={clsx('flex items-start gap-3 rounded-xl p-4', done ? 'bg-emerald/10' : 'bg-surface-secondary')}>
      {done ? (
        <CheckCircle2 className="mt-0.5 h-6 w-6 flex-shrink-0 text-emerald" aria-hidden />
      ) : (
        <Circle className="mt-0.5 h-6 w-6 flex-shrink-0 text-ink-faint" aria-hidden />
      )}
      <div>
        <p className="text-[18px] font-bold text-ink">
          {title}
          <span className="sr-only">{done ? ' (done)' : ' (not done yet)'}</span>
        </p>
        <p className="text-[16px] text-ink-muted">{detail}</p>
      </div>
    </li>
  )
}

/** "Is the rig reading my arm correctly?" */
export function CalibrationView({
  exerciseTitle,
  hubConnected,
  liveAngle,
  targetMin,
  targetMax,
  phase,
  remainingSec,
  liveEffortPct,
  results,
  onStartBaseline,
  onStartMvc,
  onRecalibrate,
  onBack,
  onContinue,
}: {
  exerciseTitle: string
  hubConnected: boolean
  /** Live elbow angle from the hub's forearm sensor, or null when there is no reading. */
  liveAngle: number | null
  targetMin: number
  targetMax: number
  phase: EffortPhase
  remainingSec: number
  liveEffortPct: number
  results: { label: string; baseline: number; mvc: number }[]
  onStartBaseline: () => void
  onStartMvc: () => void
  onRecalibrate: () => void
  onBack: () => void
  onContinue: () => void
}) {
  // Each pose is ticked the first time the live reading reaches it, and stays ticked.
  const [straightOk, setStraightOk] = useState(false)
  const [curlOk, setCurlOk] = useState(false)
  if (liveAngle !== null) {
    if (!straightOk && Math.abs(liveAngle) <= STRAIGHT_TOLERANCE_DEG) setStraightOk(true)
    if (!curlOk && liveAngle >= targetMin && liveAngle <= targetMax) setCurlOk(true)
  }
  const armChecked = straightOk && curlOk
  const effortRunning = phase === 'baseline' || phase === 'mvc'

  return (
    <>
      <SessionHeader step={1} />
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-10">
        <div>
          <p className="text-[15px] font-semibold text-ink-muted">{exerciseTitle}</p>
          <h1 className="text-[30px] font-bold tracking-tight text-ink">Check your arm reading</h1>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Part 1: the real check */}
          <Card className="flex flex-col p-6 sm:p-7">
            <h2 className="text-[20px] font-bold text-ink">1. Is the sensor reading your arm?</h2>
            {liveAngle === null ? (
              <div className="mt-4 rounded-xl bg-surface-secondary p-5">
                <StatusLabel tone="neutral" className="text-[18px]">
                  {hubConnected ? 'Waiting for the forearm sensor…' : 'The hub is not connected'}
                </StatusLabel>
                <p className="mt-2 text-[16px] text-ink-muted">
                  {hubConnected
                    ? 'Check that Pod 2 is strapped on your forearm and switched on.'
                    : "Your arm reading can't be checked without the hub. Go back to connect it, or continue and the exercise will use a simulated arm angle."}
                </p>
              </div>
            ) : (
              <>
                <div className="mt-4 flex items-end justify-between gap-4 rounded-xl bg-surface-secondary p-5">
                  <p className="text-[16px] font-semibold text-ink-muted">Arm angle now</p>
                  <p className="text-[72px] font-bold leading-none text-ink" aria-live="off">
                    {Math.round(liveAngle)}°
                  </p>
                </div>
                <ol className="mt-4 flex flex-col gap-3">
                  <CheckRow done={straightOk} title="Hold your arm straight" detail="It should read near 0°." />
                  <CheckRow done={curlOk} title="Curl to your target" detail={`It should read between ${targetMin}° and ${targetMax}°, your own target range.`} />
                </ol>
                <p className="mt-3 text-[18px]" aria-live="polite">
                  {armChecked ? (
                    <StatusLabel tone="good">The sensor is reading your arm correctly.</StatusLabel>
                  ) : (
                    <span className="text-[16px] text-ink-muted">Move slowly. Each step ticks when the reading gets there.</span>
                  )}
                </p>
                <p className="mt-2 text-[13px] text-ink-muted">
                  Placeholder rule until a physiotherapist confirms it: "near 0°" means within {STRAIGHT_TOLERANCE_DEG}°.
                </p>
              </>
            )}
          </Card>

          {/* Part 2: the optional, simulated effort step */}
          <Card className="flex flex-col p-6 sm:p-7">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[20px] font-bold text-ink">2. Muscle effort (optional)</h2>
              <SimulatedTag />
            </div>
            <p className="mt-2 text-[16px] text-ink-muted">
              Muscle readings are simulated in this version, so this step does not measure your real muscle yet. You can skip it.
            </p>

            {phase === 'idle' && (
              <div className="mt-4 flex flex-col gap-3">
                <ol className="flex flex-col gap-1.5 text-[17px] text-ink">
                  <li>Step 1: relax your arm (3 seconds).</li>
                  <li>Step 2: curl firmly, at an effort that doesn't hurt (3 seconds).</li>
                </ol>
                <p className="text-[17px] font-bold text-ink">Stop if you feel pain.</p>
                <Button variant="secondary" className="min-h-[48px] self-start text-[16px]" onClick={onStartBaseline}>
                  Start step 1
                </Button>
              </div>
            )}

            {effortRunning && (
              <div className="mt-4 flex flex-col items-center gap-4 text-center">
                <p className="text-[20px] font-bold text-ink" aria-live="assertive">
                  {phase === 'baseline' ? 'Relax your arm' : "Curl firmly, at an effort that doesn't hurt"}
                </p>
                <span className="flex h-24 w-24 items-center justify-center rounded-full bg-accent/10 text-[44px] font-bold text-accent">
                  {remainingSec}
                </span>
                {phase === 'mvc' && <p className="text-[17px] font-bold text-ink">Stop if you feel pain.</p>}
                <div className="w-full">
                  <ProgressBar value={liveEffortPct} tone="accent" />
                </div>
              </div>
            )}

            {phase === 'baseline-done' && (
              <div className="mt-4 flex flex-col gap-3">
                <StatusLabel tone="good" className="text-[18px]">
                  Step 1 done
                </StatusLabel>
                <p className="text-[17px] text-ink">Step 2: curl firmly, at an effort that doesn't hurt (3 seconds).</p>
                <p className="text-[17px] font-bold text-ink">Stop if you feel pain.</p>
                <Button variant="secondary" className="min-h-[48px] self-start text-[16px]" onClick={onStartMvc}>
                  Start step 2
                </Button>
              </div>
            )}

            {phase === 'mvc-done' && (
              <div className="mt-4 flex flex-col gap-3">
                <StatusLabel tone="good" className="text-[18px]">
                  Both steps done
                </StatusLabel>
                <Button variant="ghost" className="min-h-[44px] self-start text-[16px]" onClick={onRecalibrate}>
                  <RotateCcw className="h-4 w-4" aria-hidden />
                  Do it again
                </Button>
              </div>
            )}

            {results.length > 0 && (
              <div className="mt-auto pt-4">
                <Details summary="Details (simulated values)">
                  <p>Effort is shown as (reading − resting) ÷ (firm − resting) × 100%.</p>
                  {results.map((r) => (
                    <p key={r.label}>
                      {r.label}: resting {r.baseline.toFixed(3)}, firm {r.mvc.toFixed(3)}
                    </p>
                  ))}
                </Details>
              </div>
            )}
          </Card>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4">
          <Button variant="ghost" className="min-h-[48px] text-[16px]" onClick={onBack} disabled={effortRunning}>
            <ArrowLeft className="h-5 w-5" aria-hidden />
            Back to sensors
          </Button>
          <div className="flex flex-wrap items-center gap-4">
            {hubConnected && !armChecked && <p className="text-[15px] text-ink-muted">The arm check isn't finished yet.</p>}
            <Button
              size="lg"
              className="min-h-[52px] px-8 text-[17px]"
              variant={armChecked || !hubConnected ? 'primary' : 'secondary'}
              onClick={onContinue}
              disabled={effortRunning}
            >
              {phase === 'mvc-done' || phase === 'idle' ? 'Start the exercise' : 'Skip step 2 and start'}
              <ArrowRight className="h-5 w-5" aria-hidden />
            </Button>
          </div>
        </div>
      </main>
    </>
  )
}
