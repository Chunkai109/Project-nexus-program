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
                'flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                state === 'done' && 'border-emerald/40 bg-emerald/10 text-emerald',
                state === 'active' && 'border-electric/40 bg-electric/10 text-electric',
                state === 'upcoming' && 'border-border text-ink-faint',
              )}
            >
              <span
                className={clsx(
                  'flex h-4 w-4 items-center justify-center rounded-full text-[10px]',
                  state === 'done' && 'bg-emerald text-slate-950',
                  state === 'active' && 'bg-electric text-slate-950',
                  state === 'upcoming' && 'bg-white/10 text-ink-faint',
                )}
              >
                {state === 'done' ? <Check className="h-3 w-3" strokeWidth={3} /> : i + 1}
              </span>
              {step.label}
            </div>
            {i < steps.length - 1 && <div className={clsx('h-px w-6', i < activeIndex ? 'bg-emerald/40' : 'bg-border')} />}
          </div>
        )
      })}
    </div>
  )
}
