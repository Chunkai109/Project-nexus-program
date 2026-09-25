import { NavLink } from 'react-router-dom'
import { clsx } from 'clsx'
import { Dumbbell, History } from 'lucide-react'

const TABS = [
  { to: '/patient/exercises', label: 'Prescribed Exercises', icon: Dumbbell },
  { to: '/patient/history', label: 'Past Sessions', icon: History },
]

export function PatientNavTabs() {
  return (
    <nav className="mb-8 flex gap-2">
      {TABS.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            clsx(
              'flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-medium transition-colors duration-200',
              isActive ? 'bg-accent/10 text-accent' : 'text-ink-muted hover:bg-surface-secondary',
            )
          }
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
        </NavLink>
      ))}
    </nav>
  )
}
