import { clsx } from 'clsx'
import type { ReactNode } from 'react'
import { InspectorProvider } from '@/components/inspector/InspectorContext'
import { InspectorHUD } from '@/components/inspector/InspectorHUD'

export function PageShell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <InspectorProvider>
      <div className="min-h-screen bg-canvas text-ink">
        <div className={clsx('mx-auto max-w-[1440px]', className)}>{children}</div>
        <InspectorHUD />
      </div>
    </InspectorProvider>
  )
}
