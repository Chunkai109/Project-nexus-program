import { clsx } from 'clsx'
import type { ReactNode } from 'react'

/** `fullWidth` drops the 1440px cap so a dashboard can use the whole screen. */
export function PageShell({ children, className, fullWidth = false }: { children: ReactNode; className?: string; fullWidth?: boolean }) {
  return (
    <div className="min-h-app bg-canvas text-ink">
      <div className={clsx(fullWidth ? 'w-full' : 'mx-auto max-w-[1440px]', className)}>{children}</div>
    </div>
  )
}
