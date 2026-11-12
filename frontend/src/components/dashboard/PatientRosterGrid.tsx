import { useMemo } from 'react'
import { AlertTriangle, CheckCircle2, ChevronRight, Circle, Clock, UserRound } from 'lucide-react'
import { clsx } from 'clsx'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { useAppData } from '@/lib/data/AppDataContext'
import { formatRelativeTime, hashColor } from '@/lib/formatRelativeTime'
import { PLACEHOLDER_RULES, RULES_ARE_PLACEHOLDERS } from '@/lib/dashboardRules'
import { historyFor, sessionStats, summarizePatient, type PatientStatus } from '@/lib/sessionStats'
import { HoverExplain } from '@/components/ui/HoverExplain'
import { GoodFormChange } from './PlanTags'

/** Status shown as icon + text (never colour alone). `dot` marks the ● statuses. */
const STATUS: Record<PatientStatus, { label: string; icon: typeof CheckCircle2; className: string; order: number; dot?: boolean; explanation?: string }> = {
  'needs-attention': { label: 'Needs attention', icon: AlertTriangle, className: 'text-crimson-ink', order: 0 },
  'check-camera': {
    label: 'Check camera',
    icon: Circle,
    dot: true,
    className: 'text-amber-ink',
    order: 1,
    explanation: "The camera or AI missed most reps, so form wasn't judged. Check the camera position before the next session.",
  },
  inactive: { label: 'Inactive', icon: Circle, dot: true, className: 'text-ink-muted', order: 2 },
  'on-track': { label: 'On track', icon: CheckCircle2, className: 'text-emerald-ink', order: 3 },
  'no-sessions': { label: 'No sessions yet', icon: Clock, className: 'text-ink-muted', order: 4 },
}

function GoodFormCell({ pct, unscored, change }: { pct: number | null | undefined; unscored: number; change: number | null }) {
  if (pct == null) {
    return (
      <span className="block">
        <span className="text-ink-muted">—</span>
        {unscored > 0 && <span className="block text-[12px] text-ink-muted">The AI didn't score any reps</span>}
      </span>
    )
  }
  return (
    <span className="block">
      <span className="font-semibold tabular-nums text-ink">{pct}%</span>
      <span className="block text-[12px] tabular-nums text-ink-muted">{unscored} not scored</span>
      {change !== null && (
        <span className="mt-0.5 block text-[12px]">
          <GoodFormChange change={change} />
        </span>
      )}
    </span>
  )
}

/** One row per patient, sorted so whoever needs the physio most is at the top. */
export function PatientRosterGrid({ onSelectPatient }: { onSelectPatient?: (patientId: string) => void }) {
  const { patients, sessions } = useAppData()

  const rows = useMemo(
    () =>
      patients
        .map((p) => {
          const { sessions: history, isDemo } = historyFor(p.id, sessions)
          const summary = summarizePatient(history)
          // Real change in good-form %: the latest session vs the previous session of the same exercise.
          const latest = summary.latest
          const earlier = latest
            ? history.filter((h) => h.exerciseId === latest.session.exerciseId && h.completedAt < latest.session.completedAt)
            : []
          const prevPct = earlier.length > 0 ? sessionStats(earlier[earlier.length - 1]).goodFormPct : null
          const goodFormChange = latest?.goodFormPct != null && prevPct !== null ? latest.goodFormPct - prevPct : null
          return { patient: p, isDemo, summary, goodFormChange }
        })
        .sort(
          (a, b) =>
            STATUS[a.summary.status].order - STATUS[b.summary.status].order ||
            (b.summary.latest?.session.completedAt ?? 0) - (a.summary.latest?.session.completedAt ?? 0),
        ),
    [patients, sessions],
  )

  if (patients.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-3 p-16 text-center">
        <UserRound className="h-8 w-8 text-ink-faint" />
        <p className="text-[15px] font-medium text-ink">No patients yet</p>
        <p className="max-w-sm text-[13px] text-ink-faint">
          This list fills in automatically when a patient registers — there's nothing to add by hand.
        </p>
      </Card>
    )
  }

  const { goodFormBelowPct, driftFaultsAtLeast } = PLACEHOLDER_RULES.needsAttention

  return (
    <div>
      <Card className="overflow-hidden">
        <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,0.8fr)_20px] gap-4 border-b border-border px-6 py-3 text-[12px] font-medium text-ink-faint md:grid">
          <span>Patient</span>
          <span>Status</span>
          <span>Last session</span>
          <span>Good form</span>
          <span>Drift faults</span>
          <span />
        </div>
        {rows.map(({ patient: p, isDemo, summary, goodFormChange }) => {
          const status = STATUS[summary.status]
          const Icon = status.icon
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onSelectPatient?.(p.id)}
              className="grid w-full grid-cols-[minmax(0,1fr)_20px] items-center gap-x-4 gap-y-2 border-b border-border px-6 py-4 text-left text-[13px] transition-colors duration-150 last:border-b-0 hover:bg-surface-secondary md:grid-cols-[minmax(0,2fr)_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,0.8fr)_20px]"
            >
              <span className="flex min-w-0 items-center gap-3">
                <span
                  className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
                  style={{ background: hashColor(p.email) }}
                >
                  {p.name.charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-semibold text-ink">{p.name}</span>
                    {isDemo && <Badge tone="amber">Demo data</Badge>}
                  </span>
                  <span className="block truncate text-ink-faint">{p.email}</span>
                </span>
              </span>
              <ChevronRight className="h-4 w-4 text-ink-faint md:order-last" />

              <span className="col-span-2 md:col-span-1">
                {(() => {
                  const label = (
                    <span className={clsx('flex items-center gap-1.5 font-semibold', status.className)}>
                      <Icon className={clsx('flex-shrink-0', status.dot ? 'h-2.5 w-2.5 fill-current' : 'h-4 w-4')} aria-hidden />
                      {status.label}
                    </span>
                  )
                  return status.explanation ? <HoverExplain explanation={status.explanation}>{label}</HoverExplain> : label
                })()}
                {summary.reasons.length > 0 && <span className="mt-0.5 block text-[12px] text-ink-muted">{summary.reasons.join(' · ')}</span>}
              </span>
              <span className="col-span-2 text-ink-muted md:col-span-1">
                <span className="text-ink-faint md:hidden">Last session: </span>
                {summary.latest ? formatRelativeTime(summary.latest.session.completedAt) : '—'}
              </span>
              <span className="col-span-2 md:col-span-1">
                <span className="text-ink-faint md:hidden">Good form: </span>
                <GoodFormCell
                  pct={summary.latest?.goodFormPct}
                  unscored={summary.latest?.unscored ?? 0}
                  change={goodFormChange}
                />
              </span>
              <span className="col-span-2 text-ink-muted md:col-span-1">
                <span className="text-ink-faint md:hidden">Drift faults: </span>
                {summary.latest ? summary.latest.driftFaults : '—'}
              </span>
            </button>
          )
        })}
      </Card>
      {RULES_ARE_PLACEHOLDERS && (
        <p className="mt-3 text-[12px] leading-relaxed text-ink-faint">
          <span className="font-medium text-amber-ink">Placeholder rules</span> until a physiotherapist confirms them: <b>Needs attention</b>{' '}
          if the last session had {driftFaultsAtLeast}+ drift faults or good form under {goodFormBelowPct}%. <b>Check camera</b> if the AI
          scored half the reps or fewer. <b>Inactive</b> after {PLACEHOLDER_RULES.inactiveAfterDays} days without a session. Good form = reps
          the AI scored {PLACEHOLDER_RULES.goodFormVerdicts.join(' or ')}, out of the reps it scored.
        </p>
      )}
    </div>
  )
}
