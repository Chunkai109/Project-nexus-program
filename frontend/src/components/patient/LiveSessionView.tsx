import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, CircleSlash, FlaskConical, Loader2, Timer, Vibrate, Wifi, XCircle } from 'lucide-react'
import { clsx } from 'clsx'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { SessionHeader } from './PatientHeader'
import { Details } from './PatientBits'
import { formatClock } from './format'
import { setProgress, type VerdictDisplay } from './liveVerdict'

/** The full elbow range on this rig: 0° straight, 135° fully curled. */
const ANGLE_MAX = 135

function AngleBar({ angle, targetMin, targetMax }: { angle: number; targetMin: number; targetMax: number }) {
  const pct = (v: number) => `${(Math.min(ANGLE_MAX, Math.max(0, v)) / ANGLE_MAX) * 100}%`
  // Judge the same whole number the patient sees, so "100°" with a 100° target never reads "Below range".
  const shown = Math.round(angle)
  const state = shown < targetMin ? 'below' : shown > targetMax ? 'above' : 'in'
  return (
    <Card className="px-5 py-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-[15px] font-semibold text-ink-muted">Elbow angle</p>
          <p
            className={clsx(
              'inline-flex items-center gap-2 text-[24px] font-bold',
              state === 'in' ? 'text-emerald-ink' : state === 'above' ? 'text-amber-ink' : 'text-ink-muted',
            )}
          >
            {state === 'in' ? <CheckCircle2 className="h-7 w-7" aria-hidden /> : <CircleSlash className="h-7 w-7" aria-hidden />}
            {state === 'in' ? 'In range' : state === 'above' ? 'Above range' : 'Below range'}
          </p>
        </div>
        <p className="min-w-[2.6em] text-right text-[48px] font-bold leading-none text-ink">{shown}°</p>
      </div>
      <div className="relative mt-3 h-5 rounded-full bg-surface-secondary" role="img" aria-label={`Elbow angle ${Math.round(angle)} degrees. Target ${targetMin} to ${targetMax} degrees.`}>
        <div
          className="absolute inset-y-0 rounded-full border-x-2 border-emerald bg-emerald/25"
          style={{ left: pct(targetMin), width: `calc(${pct(targetMax)} - ${pct(targetMin)})` }}
        />
        <div className="absolute top-1/2 h-9 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink" style={{ left: pct(angle) }} />
      </div>
      <div className="relative mt-1.5 h-5 text-[14px] text-ink-muted">
        <span className="absolute left-0">0°</span>
        <span className="absolute -translate-x-1/2 whitespace-nowrap font-semibold text-emerald-ink" style={{ left: `calc((${pct(targetMin)} + ${pct(targetMax)}) / 2)` }}>
          Target {targetMin}–{targetMax}°
        </span>
        <span className="absolute right-0">{ANGLE_MAX}°</span>
      </div>
    </Card>
  )
}

function Verdict({ verdict, buzzed }: { verdict: VerdictDisplay; buzzed: boolean }) {
  const big = 'flex items-center gap-3 text-[clamp(40px,4.7vw,68px)] font-bold leading-none'
  const iconSize = 'h-[0.95em] w-[0.95em] flex-shrink-0'
  return (
    <Card className="p-5" aria-live="polite">
      <p className="text-[15px] font-semibold text-ink-muted">Last rep</p>
      {verdict.kind === 'waiting' && <p className="mt-2 text-[26px] font-bold text-ink-muted">Start your first rep</p>}
      {verdict.kind === 'checking' && (
        <p className={clsx(big, 'mt-2 text-ink-muted')}>
          <Loader2 className={clsx(iconSize, 'animate-spin')} aria-hidden />
          Checking…
        </p>
      )}
      {verdict.kind === 'verdict' && (
        <>
          <p className={clsx(big, 'mt-2', verdict.good ? 'text-emerald-ink' : 'text-crimson-ink')}>
            {verdict.good ? <CheckCircle2 className={iconSize} aria-hidden /> : <XCircle className={iconSize} aria-hidden />}
            {verdict.label}
            {verdict.good && buzzed && <Vibrate className="h-[0.55em] w-[0.55em] flex-shrink-0 animate-pulse" aria-label="Buzz sent" />}
          </p>
          {verdict.message && <p className="mt-2 line-clamp-2 text-[20px] font-medium leading-snug text-ink">{verdict.message}</p>}
        </>
      )}
      {verdict.kind === 'not-scored' && (
        <>
          <p className={clsx(big, 'mt-2 text-ink-muted')}>
            <CircleSlash className={iconSize} aria-hidden />
            Not scored
          </p>
          <p className="mt-2 text-[18px] text-ink-muted">{verdict.reason ?? 'The camera missed that rep. It still counts.'}</p>
        </>
      )}
    </Card>
  )
}

/** "Was that rep good, and how many are left?" Readable from 2 m; nothing to click mid-set. */
export function LiveSessionView({
  exerciseTitle,
  sets,
  repsPerSet,
  repCount,
  elapsedSec,
  angle,
  targetMin,
  targetMax,
  source,
  driftFault,
  verdict,
  buzzOnPerfect,
  camera,
  details,
  ending,
  onEnd,
}: {
  exerciseTitle: string
  sets: number
  repsPerSet: number
  repCount: number
  elapsedSec: number
  angle: number
  targetMin: number
  targetMax: number
  /** Where the angle comes from. 'simulated' must be visible to the patient. */
  source: 'hub' | 'simulated'
  /** `overLimitDeg` is null when the number isn't known (simulated stream). */
  driftFault: { active: boolean; overLimitDeg: number | null }
  verdict: VerdictDisplay
  /** True when a Perfect rep triggers the vibration motor (hub connected). */
  buzzOnPerfect: boolean
  camera: ReactNode
  details?: ReactNode
  ending: boolean
  onEnd: () => void
}) {
  const p = setProgress(repCount, sets, repsPerSet)

  return (
    <>
      <SessionHeader
        step={2}
        right={
          <span className="hidden items-center gap-1.5 text-[15px] font-semibold text-ink-muted md:inline-flex">
            {exerciseTitle}
          </span>
        }
      />
      <main className="mx-auto flex max-w-[1500px] flex-col gap-3 px-4 py-3 sm:px-6 lg:px-8">
        {/* One fixed-height status line, so the layout never jumps when a fault appears. */}
        <div className="flex min-h-[52px] items-stretch" aria-live="assertive">
          {driftFault.active ? (
            <p className="animate-pulse-ring-crimson flex w-full items-center gap-3 rounded-2xl bg-crimson px-5 py-2 text-[clamp(22px,2.4vw,32px)] font-bold text-accent-ink">
              <AlertTriangle className="h-[1.1em] w-[1.1em] flex-shrink-0" aria-hidden />
              Keep your upper arm still
              {driftFault.overLimitDeg !== null && driftFault.overLimitDeg > 0 && (
                <span> · {driftFault.overLimitDeg}° over your limit</span>
              )}
            </p>
          ) : source === 'simulated' ? (
            <p className="flex w-full items-center gap-2.5 rounded-2xl bg-amber/10 px-5 py-2 text-[18px] font-semibold text-amber-ink">
              <FlaskConical className="h-5 w-5 flex-shrink-0" aria-hidden />
              No hub connected. The arm angle and reps on this screen are simulated.
            </p>
          ) : (
            <p className="flex w-full items-center gap-2.5 rounded-2xl bg-surface-secondary px-5 py-2 text-[18px] font-semibold text-ink-muted">
              <Wifi className="h-5 w-5 flex-shrink-0" aria-hidden />
              Sensors live. Upper arm steady.
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.02fr_1fr]">
          <div className="flex min-w-0 flex-col gap-3">
            {camera}
            <AngleBar angle={angle} targetMin={targetMin} targetMax={targetMax} />
          </div>

          <div className="flex min-w-0 flex-col gap-3">
            <Card className="flex flex-col items-center px-5 py-4 text-center">
              {p.allDone ? (
                <>
                  <p className="inline-flex items-center gap-2 text-[26px] font-bold text-emerald-ink">
                    <CheckCircle2 className="h-7 w-7" aria-hidden />
                    All sets done
                  </p>
                  <p data-rep-digits className="text-[clamp(110px,12.5vw,190px)] font-bold leading-[0.9] text-ink">
                    {repCount}
                  </p>
                  <p className="text-[24px] font-semibold text-ink-muted">reps. Press End session.</p>
                </>
              ) : (
                <>
                  <p className="text-[26px] font-bold text-ink">
                    Set <span>{p.setNumber}</span> of <span>{sets}</span>
                    {p.justFinishedSet && <span className="text-emerald-ink"> · set {p.setNumber - 1} done</span>}
                  </p>
                  <p className="flex items-baseline gap-3 leading-[0.9] text-ink">
                    <span className="sr-only">Rep </span>
                    <span data-rep-digits className="min-w-[0.62em] text-right text-[clamp(110px,12.5vw,190px)] font-bold">
                      {p.repInSet}
                    </span>
                    <span className="text-[clamp(32px,3.4vw,52px)] font-bold text-ink-muted">of {repsPerSet}</span>
                  </p>
                  <p className="text-[20px] font-semibold text-ink-muted">reps done in this set</p>
                </>
              )}
            </Card>

            <Verdict verdict={verdict} buzzed={buzzOnPerfect} />

            <div className="flex items-center justify-between gap-4">
              <p className="inline-flex min-w-[5.2em] items-center gap-2 text-[32px] font-bold text-ink">
                <Timer className="h-7 w-7 text-accent" aria-hidden />
                {formatClock(elapsedSec)}
              </p>
              <Button size="lg" className="min-h-[60px] px-8 text-[20px]" onClick={onEnd} disabled={ending}>
                {ending ? 'Saving…' : 'End session'}
              </Button>
            </div>
          </div>
        </div>

        {details && <Details summary="Details for a helper">{details}</Details>}
      </main>
    </>
  )
}
