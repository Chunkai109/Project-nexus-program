import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, CircleSlash, FlaskConical, type LucideIcon } from 'lucide-react'
import { clsx } from 'clsx'

export type StatusTone = 'good' | 'warning' | 'fault' | 'neutral'

const TONE: Record<StatusTone, { icon: LucideIcon; text: string }> = {
  good: { icon: CheckCircle2, text: 'text-emerald-ink' },
  warning: { icon: AlertTriangle, text: 'text-amber-ink' },
  fault: { icon: AlertTriangle, text: 'text-crimson-ink' },
  neutral: { icon: CircleSlash, text: 'text-ink-muted' },
}

/** A status as icon + words, never colour alone. */
export function StatusLabel({ tone, children, className }: { tone: StatusTone; children: ReactNode; className?: string }) {
  const { icon: Icon, text } = TONE[tone]
  return (
    <span className={clsx('inline-flex items-center gap-1.5 font-semibold', text, className)}>
      <Icon className="h-[1.1em] w-[1.1em] flex-shrink-0" aria-hidden />
      {children}
    </span>
  )
}

/** Marks a reading the rig does not really measure yet (muscle effort). */
export function SimulatedTag() {
  return (
    <span
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-amber/10 px-2.5 py-1 text-[13px] font-semibold text-amber-ink"
      title="This reading is simulated in this version. The muscle sensor is not read yet."
    >
      <FlaskConical className="h-3.5 w-3.5" aria-hidden />
      Simulated
    </span>
  )
}

/** Shown on every screen of the demo preview so it can never pass for a real record. */
export function DemoBanner() {
  return (
    <div role="note" className="flex items-center justify-center gap-2 bg-amber/10 px-4 py-2 text-center text-[14px] font-semibold text-amber-ink">
      <FlaskConical className="h-4 w-4 flex-shrink-0" aria-hidden />
      Demo data. Not a real patient or a real session. Nothing here is saved.
    </div>
  )
}

/** A collapsed block for technical detail a patient doesn't need but a helper might. */
export function Details({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="group rounded-xl bg-surface-secondary px-4 py-3 text-[14px] text-ink-muted">
      <summary className="cursor-pointer select-none font-medium text-ink-muted">{summary}</summary>
      <div className="mt-3 flex flex-col gap-2">{children}</div>
    </details>
  )
}
