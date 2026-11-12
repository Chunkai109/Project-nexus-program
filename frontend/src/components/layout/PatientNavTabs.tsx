import { NavLink } from 'react-router-dom'
import { clsx } from 'clsx'
import { Dumbbell, History } from 'lucide-react'

const TABS = [
  { to: '/patient/exercises', label: "Today's exercises", icon: Dumbbell },
  { to: '/patient/history', label: 'Past sessions', icon: History },
]

export function PatientNavTabs() {
  return (
    <nav aria-label="Patient pages" className="mb-8 flex flex-wrap gap-2">
      {TABS.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            clsx(
              'flex min-h-[44px] items-center gap-2 rounded-full px-5 py-2.5 text-[16px] font-semibold transition-colors duration-200',
              isActive ? 'bg-accent/10 text-accent' : 'text-ink-muted hover:bg-surface-secondary',
            )
          }
        >
          <Icon className="h-[18px] w-[18px]" aria-hidden />
          {label}
        </NavLink>
      ))}
    </nav>
  )
}
