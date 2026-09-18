import { Activity } from 'lucide-react'
import { clsx } from 'clsx'

export function Logo({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const iconBox = { sm: 'h-7 w-7', md: 'h-9 w-9', lg: 'h-12 w-12' }[size]
  const iconSize = { sm: 15, md: 18, lg: 24 }[size]
  const text = { sm: 'text-base', md: 'text-lg', lg: 'text-2xl' }[size]

  return (
    <div className="flex items-center gap-2.5">
      <div
        className={clsx(
          'flex items-center justify-center rounded-xl bg-gradient-to-br from-electric to-emerald shadow-[0_0_20px_-2px_rgba(56,189,248,0.5)]',
          iconBox,
        )}
      >
        <Activity size={iconSize} strokeWidth={2.5} className="text-slate-950" />
      </div>
      <span className={clsx('font-bold tracking-tight text-ink', text)}>SmartPhysio</span>
    </div>
  )
}
