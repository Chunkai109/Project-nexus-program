import type { ReactNode } from 'react'
import { AlertCircle, type LucideIcon } from 'lucide-react'
import { clsx } from 'clsx'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'

/** Icon, one sentence, one action. */
export function EmptyState({ icon: Icon, message, action, className }: { icon: LucideIcon; message: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <Card className={clsx('flex flex-col items-center gap-3 px-6 py-12 text-center', className)}>
      <Icon className="h-7 w-7 text-ink-muted" aria-hidden />
      <p className="max-w-[46ch] text-[15px] text-ink">{message}</p>
      {action}
    </Card>
  )
}

export function ErrorState({ message, onRetry, className }: { message: string; onRetry?: () => void; className?: string }) {
  return (
    <Card className={clsx('flex flex-col items-center gap-3 px-6 py-12 text-center', className)} role="alert">
      <AlertCircle className="h-7 w-7 text-crimson-ink" aria-hidden />
      <p className="max-w-[46ch] text-[15px] font-medium text-crimson-ink">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="md" onClick={onRetry}>
          Try again
        </Button>
      )}
    </Card>
  )
}

/** A grey block the shape of the content that is loading. Does not animate. */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={clsx('block rounded-lg bg-surface-secondary', className)} />
}
