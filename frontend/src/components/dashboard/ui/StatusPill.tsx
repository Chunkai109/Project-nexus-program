import { clsx } from 'clsx'
import type { RosterStatus } from '../physioModel'
import { STATUS_META } from './statusMeta'
import { HoverExplain } from '@/components/ui/HoverExplain'

const CHECK_CAMERA = "The camera or AI missed most reps, so form wasn't judged. Check the camera position before the next session."

export function StatusPill({ status, reason, size = 'md' }: { status: RosterStatus; reason?: string | null; size?: 'md' | 'lg' }) {
  const meta = STATUS_META[status]
  const Icon = meta.icon
  const label = (
    <span className={clsx('inline-flex items-center gap-1.5 font-semibold', meta.text, size === 'lg' ? 'text-[15px]' : 'text-[14px]')}>
      <Icon className="h-4 w-4 flex-shrink-0" aria-hidden />
      {meta.label}
    </span>
  )
  return (
    <span className="block min-w-0">
      {status === 'check-camera' ? <HoverExplain className="inline-flex" explanation={CHECK_CAMERA}>{label}</HoverExplain> : label}
      {reason && <span className="mt-0.5 block truncate text-[13px] text-ink-muted" title={reason}>{reason}</span>}
    </span>
  )
}
