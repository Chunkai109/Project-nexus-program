import { clsx } from 'clsx'
import { Check } from 'lucide-react'

interface Step {
  label: string
}

export function Breadcrumb({ steps, activeIndex }: { steps: Step[]; activeIndex: number }) {
  return (
    <div className="flex items-center gap-2">
      {steps.map((step, i) => {
        const state = i < activeIndex ? 'done' : i === activeIndex ? 'active' : 'upcoming'
        return (
          <div key={step.label} className="flex items-center gap-2">
            <div
              className={clsx(
                'flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                state === 'done' && 'bg-emerald/10 text-emerald',
                state === 'active' && 'bg-accent/10 text-accent',
                state === 'upcoming' && 'text-ink-faint',
              )}
            >
              <span
                className={clsx(
                  'flex h-4 w-4 items-center justify-center rounded-full text-[10px]',
                  state === 'done' && 'bg-emerald text-white',
                  state === 'active' && 'bg-accent text-white',
                  state === 'upcoming' && 'bg-surface-secondary text-ink-faint',
                )}
              >
                {state === 'done' ? <Check className="h-3 w-3" strokeWidth={3} /> : i + 1}
              </span>
              <span className="hidden sm:inline">{step.label}</span>
            </div>
            {i < steps.length - 1 && (
              <div className={clsx('h-px w-3 sm:w-6', i < activeIndex ? 'bg-emerald/40' : 'bg-border')} />
            )}
          </div>
        )
      })}
    </div>
  )
}
