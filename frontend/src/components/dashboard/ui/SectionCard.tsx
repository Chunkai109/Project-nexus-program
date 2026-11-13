import type { ReactNode } from 'react'
import { clsx } from 'clsx'
import { Card } from '@/components/ui/Card'

/** A card with a 16px title, an optional one-line subtitle (the takeaway), and 24px padding. */
export function SectionCard({
  title,
  subtitle,
  actions,
  children,
  className,
  headingLevel = 2,
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  className?: string
  headingLevel?: 2 | 3
}) {
  const H = headingLevel === 2 ? 'h2' : 'h3'
  return (
    <Card className={clsx('p-6', className)}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <H className="text-[16px] font-semibold text-ink">{title}</H>
          {subtitle && <p className="mt-0.5 text-[14px] text-ink-muted">{subtitle}</p>}
        </div>
        {actions}
      </div>
      {children}
    </Card>
  )
}
