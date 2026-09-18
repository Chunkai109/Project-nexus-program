import { clsx } from 'clsx'
import type { UserRole } from '@/types'

export function RoleToggle({ value, onChange }: { value: UserRole; onChange: (role: UserRole) => void }) {
  return (
    <div className="relative grid grid-cols-2 rounded-full bg-surface-secondary p-1 text-sm">
      <div
        className="absolute inset-y-1 w-[calc(50%-4px)] rounded-full bg-surface shadow-[var(--shadow-ambient)] transition-transform duration-200 ease-out"
        style={{ transform: value === 'patient' ? 'translateX(0)' : 'translateX(calc(100% + 8px))' }}
      />
      <button
        type="button"
        onClick={() => onChange('patient')}
        className={clsx(
          'relative z-10 rounded-full py-2.5 transition-colors duration-200',
          value === 'patient' ? 'font-semibold text-ink' : 'text-ink-muted',
        )}
      >
        Patient Portal
      </button>
      <button
        type="button"
        onClick={() => onChange('physio')}
        className={clsx(
          'relative z-10 rounded-full py-2.5 transition-colors duration-200',
          value === 'physio' ? 'font-semibold text-ink' : 'text-ink-muted',
        )}
      >
        Physiotherapist Portal
      </button>
    </div>
  )
}
