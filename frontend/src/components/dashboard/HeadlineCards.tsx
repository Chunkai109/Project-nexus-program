import type { ReactNode } from 'react'
import { Card } from '@/components/ui/Card'
import { HoverExplain } from '@/components/ui/HoverExplain'
import { formatRelativeTime } from '@/lib/formatRelativeTime'
import { PLACEHOLDER_RULES, RULES_ARE_PLACEHOLDERS } from '@/lib/dashboardRules'
import { demoGoodFormChange, type SessionStats } from '@/lib/sessionStats'
import { DemoGoodFormChange } from './PlanTags'

type Better = 'higher' | 'lower'

/** Change vs the previous session, in words and an arrow, coloured by whether it's an improvement. */
function Change({ current, previous, unit, better }: { current: number | null; previous: number | null | undefined; unit: 'pts' | 'count'; better: Better }) {
  if (previous === undefined) return <span className="text-ink-faint">First session</span>
  if (current === null || previous === null) return <span className="text-ink-faint">No comparison</span>
  const delta = current - previous
  if (delta === 0) return <span className="text-ink-faint">No change vs last session</span>
  const improved = better === 'higher' ? delta > 0 : delta < 0
  const size = Math.abs(delta)
  const words = unit === 'pts' ? `${size} ${size === 1 ? 'pt' : 'pts'}` : delta > 0 ? `${size} more` : `${size} fewer`
  return (
    <span className={improved ? 'font-medium text-emerald' : 'font-medium text-crimson'}>
      {delta > 0 ? '▲' : '▼'} {words} vs last session
    </span>
  )
}

function HeadlineCard({ label, value, change, detail, explanation }: { label: string; value: string; change: ReactNode; detail: string; explanation: string }) {
  return (
    <HoverExplain explanation={explanation}>
      <Card className="flex h-full flex-col p-5">
        <p className="text-[13px] font-medium text-ink-muted">{label}</p>
        <p className="mt-1.5 text-[30px] font-semibold leading-none tracking-tight tabular-nums text-ink">{value}</p>
        <div className="mt-2.5 text-[12px]">{change}</div>
        <p className="mt-auto pt-2 text-[12px] tabular-nums text-ink-muted">{detail}</p>
      </Card>
    </HoverExplain>
  )
}

export function HeadlineCards({ latest, previous, sessionCount }: { latest: SessionStats; previous: SessionStats | null; sessionCount: number }) {
  const prev = previous ?? undefined
  const goodFormLabel = PLACEHOLDER_RULES.goodFormVerdicts.join(' or ')
  return (
    <div>
      <div className="grid grid-cols-1 gap-4 @md:grid-cols-2 @3xl:grid-cols-4">
        <HeadlineCard
          label="Good-form reps"
          value={latest.goodFormPct === null ? '—' : `${latest.goodFormPct}%`}
          change={
            latest.goodFormPct === null ? (
              <span className="text-ink-muted">No comparison</span>
            ) : !previous ? (
              <span className="text-ink-faint">First session</span>
            ) : (
              <DemoGoodFormChange change={demoGoodFormChange(latest.session.patientId, latest.session.id)} />
            )
          }
          detail={
            latest.aiScored === 0
              ? "The AI didn't score any reps"
              : `${latest.goodForm} ${goodFormLabel} of ${latest.aiScored} scored reps · ${latest.unscored} of ${latest.totalReps} not scored`
          }
          explanation={`Share of the AI-scored reps in the last session that the AI rated ${goodFormLabel}. Reps the AI didn't score are left out.`}
        />
        <HeadlineCard
          label="Reps in target range"
          value={latest.inRangePct === null ? '—' : `${latest.inRangePct}%`}
          change={<Change current={latest.inRangePct} previous={prev?.inRangePct} unit="pts" better="higher" />}
          detail={`${latest.inRange} of ${latest.totalReps} reps · target ${latest.session.targetMin}–${latest.session.targetMax}°`}
          explanation="Share of reps in the last session whose peak elbow angle landed inside the prescribed target range."
        />
        <HeadlineCard
          label="Drift faults"
          value={String(latest.driftFaults)}
          change={<Change current={latest.driftFaults} previous={prev?.driftFaults} unit="count" better="lower" />}
          detail="Reps where the upper arm moved too far"
          explanation="Reps in the last session where the upper-arm sensor flagged the elbow drifting forward (cheating the curl). Fewer is better."
        />
        <HeadlineCard
          label="Sessions done"
          value={String(sessionCount)}
          change={<span className="text-ink-faint">Last session {formatRelativeTime(latest.session.completedAt)}</span>}
          detail={latest.session.exerciseTitle}
          explanation="Completed sessions of this exercise on record for this patient."
        />
      </div>
      {RULES_ARE_PLACEHOLDERS && (
        <p className="mt-3 text-[12px] text-ink-faint">
          <span className="font-medium text-amber">Placeholder rule:</span> good form = reps the AI scored {goodFormLabel}, out of the reps
          it scored, until a physiotherapist confirms the rule.
        </p>
      )}
    </div>
  )
}
