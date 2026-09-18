import { Activity } from 'lucide-react'
import { clsx } from 'clsx'

export function Logo({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const iconBox = { sm: 'h-7 w-7', md: 'h-8 w-8', lg: 'h-11 w-11' }[size]
  const iconSize = { sm: 14, md: 16, lg: 22 }[size]
  const text = { sm: 'text-[15px]', md: 'text-base', lg: 'text-2xl' }[size]

  return (
    <div className="flex items-center gap-2.5">
      <div className={clsx('flex items-center justify-center rounded-xl bg-accent', iconBox)}>
        <Activity size={iconSize} strokeWidth={2.5} className="text-white" />
      </div>
      <span className={clsx('font-semibold tracking-tight text-ink', text)}>SmartPhysio</span>
    </div>
  )
}
