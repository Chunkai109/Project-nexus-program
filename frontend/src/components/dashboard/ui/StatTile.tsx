import type { ReactNode } from 'react'
import { Card } from '@/components/ui/Card'

export type Better = 'higher' | 'lower'

/**
 * A change in words with an arrow. Coloured by whether it is an improvement,
 * using the -ink text tokens; "No change" stays neutral.
 */
export function ChangeText({ delta, unit, better = 'higher', suffix = ' vs last session' }: { delta: number; unit: 'pts' | 'count'; better?: Better; suffix?: string }) {
  if (delta === 0) return <span className="text-ink-muted">No change{suffix}</span>
  const improved = better === 'higher' ? delta > 0 : delta < 0
  const size = Math.abs(delta)
  const words = unit === 'pts' ? `${size} ${size === 1 ? 'pt' : 'pts'}` : `${size} ${delta > 0 ? 'more' : 'fewer'}`
  const tail = unit === 'count' ? suffix.replace(' vs ', ' than ') : suffix
  return (
    <span className={improved ? 'font-medium text-emerald-ink' : 'font-medium text-crimson-ink'}>
      {delta > 0 ? '▲' : '▼'} {words}
      {tail}
    </span>
  )
}

/** A label, one number, what it is compared with, and what it is based on. */
export function StatTile({ label, value, change, footnote }: { label: string; value: string; change: ReactNode; footnote: ReactNode }) {
  return (
    <Card className="flex h-full flex-col p-5">
      <p className="text-[14px] font-medium text-ink-muted">{label}</p>
      <p className="mt-1.5 text-[32px] font-semibold leading-none tracking-tight tabular-nums text-ink">{value}</p>
      <p className="mt-2.5 text-[13px]">{change}</p>
      <p className="mt-auto pt-2 text-[13px] text-ink-muted">{footnote}</p>
    </Card>
  )
}
