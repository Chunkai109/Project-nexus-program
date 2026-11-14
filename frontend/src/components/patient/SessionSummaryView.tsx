import type { ReactNode } from 'react'
import { ArrowRight, CheckCircle2, CircleSlash, Lightbulb, XCircle } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { Logo } from '@/components/layout/Logo'
import { TrendChart } from '@/components/charts/TrendChart'
import { Details, MeasuredTag, SimulatedTag } from './PatientBits'
import { formatClock } from './format'
import { TIP_RULES, sessionTip } from './sessionTip'
import { aiClassOf, isInRange, type SessionStats } from '@/lib/sessionStats'
import { PatientContainer } from './PatientContainer'

/** "▲ 12 pts vs last time", coloured by whether it is an improvement, always with an arrow and words. */
function VsLast({ now, before, unit, better }: { now: number | null; before: number | null | undefined; unit: 'pts' | 'count'; better: 'higher' | 'lower' }) {
  if (before === undefined) return <span className="text-ink-muted">First session</span>
  if (now === null || before === null) return <span className="text-ink-muted">No comparison</span>
  const delta = now - before
  if (delta === 0) return <span className="font-medium text-ink-muted">● Same as last time</span>
  const improved = better === 'higher' ? delta > 0 : delta < 0
  const size = Math.abs(delta)
  const words = unit === 'pts' ? `${size} ${size === 1 ? 'pt' : 'pts'}` : delta > 0 ? `${size} more` : `${size} fewer`
  return (
    <span className={improved ? 'font-semibold text-emerald-ink' : 'font-semibold text-crimson-ink'}>
      {delta > 0 ? '▲' : '▼'} {words} vs last time
    </span>
  )
}

function Tile({ label, value, change, detail }: { label: string; value: string; change: ReactNode; detail: string }) {
  return (
    <Card className="flex flex-col p-5">
      <p className="text-[16px] font-semibold text-ink-muted">{label}</p>
      <p className="mt-1 text-[44px] font-bold leading-none tracking-tight text-ink">{value}</p>
      <p className="mt-2.5 text-[15px]">{change}</p>
      <p className="mt-auto pt-2 text-[14px] text-ink-muted">{detail}</p>
    </Card>
  )
}

/** "How did today go compared with last time?" */
export function SessionSummaryView({
  stats,
  previous,
  avgEffortPct,
  emgSource = 'simulated',
  banner,
  onDone,
}: {
  stats: SessionStats
  /** The previous session of the same exercise, or null if this is the first. */
  previous: SessionStats | null
  /** Average muscle effort, shown only under Details. */
  avgEffortPct: number | null
  /** Where muscle effort came from in this session. 'unknown' when the summary is opened later. */
  emgSource?: 'hub' | 'mixed' | 'simulated' | 'unknown'
  banner?: ReactNode
  onDone: () => void
}) {
  const { session } = stats
  const prev = previous ?? undefined
  const when = new Date(session.completedAt)

  return (
    <>
      {banner}
      <header className="translucent-header sticky top-0 z-20 border-b border-border">
        <PatientContainer className="flex items-center justify-between gap-3 py-3">
        <Logo size="sm" />
        <span className="inline-flex items-center gap-2 text-[16px] font-semibold text-emerald-ink">
          <CheckCircle2 className="h-5 w-5" aria-hidden />
          Session finished
        </span>
        <ThemeToggle />
        </PatientContainer>
      </header>

      <main>
        <PatientContainer className="flex flex-col gap-6 py-6 sm:py-8 lg:py-10">
        <div>
          <h1 className="text-[30px] font-bold tracking-tight text-ink">{session.exerciseTitle}</h1>
          <p className="mt-1 text-[17px] text-ink-muted">
            {when.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })} · {stats.totalReps} reps in{' '}
            {formatClock(session.durationSec)} · target {session.targetMin}–{session.targetMax}°
          </p>
        </div>

        <Card className="flex items-start gap-4 border-accent/30 bg-accent/10 p-6">
          <Lightbulb className="mt-0.5 h-7 w-7 flex-shrink-0 text-accent" aria-hidden />
          <div>
            <h2 className="text-[16px] font-semibold text-ink-muted">One thing for next time</h2>
            <p className="mt-0.5 text-[22px] font-bold leading-snug text-ink">{sessionTip(stats)}</p>
          </div>
        </Card>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Tile
            label="Good form"
            value={stats.goodFormPct === null ? '—' : `${stats.goodFormPct}%`}
            change={<VsLast now={stats.goodFormPct} before={prev?.goodFormPct} unit="pts" better="higher" />}
            detail={
              stats.aiScored === 0
                ? "The camera didn't score any reps"
                : `${stats.goodForm} Perfect of ${stats.aiScored} scored · ${stats.unscored} not scored`
            }
          />
          <Tile
            label="In your target range"
            value={stats.inRangePct === null ? '—' : `${stats.inRangePct}%`}
            change={<VsLast now={stats.inRangePct} before={prev?.inRangePct} unit="pts" better="higher" />}
            detail={`${stats.inRange} of ${stats.totalReps} reps`}
          />
          <Tile
            label="Upper-arm drift faults"
            value={String(stats.driftFaults)}
            change={<VsLast now={stats.driftFaults} before={prev?.driftFaults} unit="count" better="lower" />}
            detail="Reps where your upper arm moved too far"
          />
          <Tile
            label="Reps"
            value={String(stats.totalReps)}
            change={<VsLast now={stats.totalReps} before={prev?.totalReps} unit="count" better="higher" />}
            detail={`${formatClock(session.durationSec)} long`}
          />
        </div>
        <p className="-mt-2 text-[14px] leading-relaxed text-ink-muted">
          <span className="font-semibold text-amber-ink">Placeholder rules</span> until a physiotherapist confirms them: good form = reps the
          camera scored Perfect, out of the reps it scored. The tip above looks, in order, at: camera scored half the reps or fewer;{' '}
          {TIP_RULES.driftFaultsAtLeast}+ drift faults; your most common fault; under {TIP_RULES.inRangeBelowPct}% in range.
        </p>

        <Card className="p-6">
          <h2 className="mb-3 text-[19px] font-bold text-ink">Each rep</h2>
          <TrendChart reps={session.reps} targetMin={session.targetMin} targetMax={session.targetMax} height={220} />
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[480px] border-collapse text-[16px]">
              <thead>
                <tr className="border-b border-border-strong text-left text-[14px] text-ink-muted">
                  <th scope="col" className="py-2 pr-3 font-semibold">Rep</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">Top angle</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">In range</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">Drift fault</th>
                  <th scope="col" className="py-2 font-semibold">Camera verdict</th>
                </tr>
              </thead>
              <tbody>
                {session.reps.map((r) => {
                  const cls = aiClassOf(r)
                  const inRange = isInRange(r, session)
                  return (
                    <tr key={r.rep} className="border-b border-border last:border-b-0">
                      <th scope="row" className="py-2 pr-3 text-left font-semibold text-ink">{r.rep}</th>
                      <td className="py-2 pr-3 text-ink">{r.angle}°</td>
                      <td className="py-2 pr-3">
                        {inRange ? (
                          <span className="inline-flex items-center gap-1.5 text-emerald-ink">
                            <CheckCircle2 className="h-4 w-4" aria-hidden /> Yes
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-ink-muted">
                            <CircleSlash className="h-4 w-4" aria-hidden /> No
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        {r.faultActive ? (
                          <span className="inline-flex items-center gap-1.5 font-semibold text-crimson-ink">
                            <XCircle className="h-4 w-4" aria-hidden /> Yes
                          </span>
                        ) : (
                          <span className="text-ink-muted">No</span>
                        )}
                      </td>
                      <td className="py-2">
                        {cls === 'Perfect' ? (
                          <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-ink">
                            <CheckCircle2 className="h-4 w-4" aria-hidden /> Perfect
                          </span>
                        ) : cls ? (
                          <span className="inline-flex items-center gap-1.5 font-semibold text-crimson-ink">
                            <XCircle className="h-4 w-4" aria-hidden /> {cls}
                          </span>
                        ) : (
                          <span className="text-ink-muted">Not scored</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>

        {avgEffortPct !== null && (
          <Details summary="Details">
            <p className="flex flex-wrap items-center gap-2">
              Average muscle effort: <span className="font-semibold text-ink">{avgEffortPct}%</span>{' '}
              {emgSource === 'hub' ? <MeasuredTag /> : emgSource === 'simulated' ? <SimulatedTag /> : null}
            </p>
            <p>
              {emgSource === 'hub'
                ? 'Measured by the muscle sensor on your bicep, against your resting and firm readings from the Check screen.'
                : emgSource === 'mixed'
                  ? 'Partly measured by the muscle sensor and partly simulated, because the sensor dropped out during the session.'
                  : emgSource === 'simulated'
                    ? 'Simulated from the arm angle, because the muscle sensor was not connected or its effort step was skipped.'
                    : 'This page does not know whether this was measured or simulated. It only knows straight after a session.'}
            </p>
          </Details>
        )}

        <Button size="lg" className="min-h-[56px] w-full text-[18px]" onClick={onDone}>
          Back to today's exercises
          <ArrowRight className="h-5 w-5" aria-hidden />
        </Button>
      </PatientContainer>
      </main>
    </>
  )
}
