import { clsx } from 'clsx'
import type { UserRole } from '@/types'

export function RoleToggle({ value, onChange }: { value: UserRole; onChange: (role: UserRole) => void }) {
  return (
    <div className="relative grid grid-cols-2 rounded-xl border border-border bg-white/[0.03] p-1 text-sm font-medium">
      <div
        className="absolute inset-y-1 w-[calc(50%-4px)] rounded-lg bg-electric shadow-[0_0_16px_-2px_rgba(56,189,248,0.6)] transition-transform duration-200 ease-out"
        style={{ transform: value === 'patient' ? 'translateX(0)' : 'translateX(calc(100% + 8px))' }}
      />
      <button
        type="button"
        onClick={() => onChange('patient')}
        className={clsx('relative z-10 rounded-lg py-2.5 transition-colors', value === 'patient' ? 'text-slate-950' : 'text-ink-muted')}
      >
        Patient Portal
      </button>
      <button
        type="button"
        onClick={() => onChange('physio')}
        className={clsx('relative z-10 rounded-lg py-2.5 transition-colors', value === 'physio' ? 'text-slate-950' : 'text-ink-muted')}
      >
        Physiotherapist Portal
      </button>
    </div>
  )
}
