import { clsx } from 'clsx'
import type { ReactNode } from 'react'

export function PageShell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="noise-bg min-h-screen bg-base text-ink">
      <div className={clsx('mx-auto max-w-[1440px]', className)}>{children}</div>
    </div>
  )
}
