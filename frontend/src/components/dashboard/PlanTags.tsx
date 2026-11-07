import { clsx } from 'clsx'
import { Badge } from '@/components/ui/Badge'
import { HoverExplain } from '@/components/ui/HoverExplain'

/** Marks a setting that's saved but not yet used by live sessions (fault angle threshold, muscle targets). */
export function NotUsedYetTag() {
  return (
    <HoverExplain className="inline-flex" explanation="Saved with this plan. The AI form check will use it in a future version.">
      <span
        className="inline-flex items-center whitespace-nowrap rounded-full bg-surface-secondary px-2 py-0.5 text-[11px] font-medium text-ink-muted"
        aria-label="Not used in sessions yet. Saved with this plan. The AI form check will use it in a future version."
      >
        Not used in sessions yet
      </span>
    </HoverExplain>
  )
}

/** The one placeholder number on the dashboard: the good-form "vs last session" change. */
export function DemoTag() {
  return (
    <HoverExplain className="inline-flex" explanation="Placeholder comparison for the demo. Not calculated from this patient's sessions.">
      <Badge tone="amber" className="!px-2 !py-0.5 !text-[11px]">
        Demo
      </Badge>
    </HoverExplain>
  )
}

/** "▲ 13 pts vs last session" etc. The value is DEMO DATA, so it always carries the Demo tag. */
export function DemoGoodFormChange({ change }: { change: number }) {
  const size = Math.abs(change)
  const words = change === 0 ? '● no change' : `${change > 0 ? '▲' : '▼'} ${size} ${size === 1 ? 'pt' : 'pts'} vs last session`
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className={clsx('font-medium', change > 0 ? 'text-emerald' : change < 0 ? 'text-crimson' : 'text-ink-muted')}>{words}</span>
      <DemoTag />
    </span>
  )
}
