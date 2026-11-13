import { Check } from 'lucide-react'
import { clsx } from 'clsx'

/** The editor's three steps, in order. Done steps show a tick and the word "done" for screen readers. */
export function StepChips({ steps, activeIndex }: { steps: { label: string }[]; activeIndex: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-2" aria-label="Steps">
      {steps.map((step, i) => {
        const state = i < activeIndex ? 'done' : i === activeIndex ? 'active' : 'upcoming'
        return (
          <li key={step.label} className="flex items-center gap-2" aria-current={state === 'active' ? 'step' : undefined}>
            <span
              className={clsx(
                'inline-flex min-h-[36px] items-center gap-2 rounded-full border px-3 text-[14px] font-semibold',
                state === 'active' ? 'border-accent bg-accent/10 text-ink' : 'border-border-strong text-ink-muted',
              )}
            >
              <span
                aria-hidden
                className={clsx(
                  'flex h-5 w-5 items-center justify-center rounded-full text-[13px]',
                  state === 'active' ? 'bg-accent text-accent-ink' : state === 'done' ? 'bg-ink-muted text-surface' : 'bg-surface-secondary text-ink-muted',
                )}
              >
                {state === 'done' ? <Check className="h-3 w-3" strokeWidth={3} /> : i + 1}
              </span>
              {step.label}
              {state === 'done' && <span className="sr-only"> (done)</span>}
            </span>
            {i < steps.length - 1 && <span aria-hidden className="h-px w-4 bg-border-strong" />}
          </li>
        )
      })}
    </ol>
  )
}
