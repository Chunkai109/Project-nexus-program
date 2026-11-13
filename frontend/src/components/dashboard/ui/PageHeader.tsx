import type { ReactNode } from 'react'

/** Page title (28px), one-line subtitle, and optional actions on the right. */
export function PageHeader({ title, subtitle, actions, above }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; above?: ReactNode }) {
  return (
    <div className="mb-8">
      {above && <div className="mb-4">{above}</div>}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-ink">{title}</h1>
          {subtitle && <p className="mt-1.5 max-w-[72ch] text-[15px] text-ink-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  )
}
