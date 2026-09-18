import { clsx } from 'clsx'
import type { ReactNode } from 'react'

export function PageShell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <div className={clsx('mx-auto max-w-[1440px]', className)}>{children}</div>
    </div>
  )
}
