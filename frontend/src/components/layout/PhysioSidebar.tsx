import { Users, Dumbbell, LineChart, Settings, LogOut } from 'lucide-react'
import { Logo } from './Logo'
import { useAuth } from '@/lib/AuthContext'
import { useNavigate } from 'react-router-dom'
import { clsx } from 'clsx'
import { useState } from 'react'

const NAV_ITEMS = [
  { key: 'roster', label: 'Patient Roster', icon: Users },
  { key: 'creator', label: 'Exercise Creator', icon: Dumbbell },
  { key: 'analytics', label: 'Session Analytics', icon: LineChart },
  { key: 'settings', label: 'Settings', icon: Settings },
] as const

export function PhysioSidebar({
  active,
  onSelect,
}: {
  active: string
  onSelect: (key: string) => void
}) {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [hover, setHover] = useState<string | null>(null)

  return (
    <aside className="flex h-screen w-64 flex-shrink-0 flex-col border-r border-border bg-base-raised/60 px-4 py-6">
      <div className="px-2">
        <Logo size="sm" />
        <p className="mt-1 pl-0.5 text-xs text-ink-faint">Physiotherapist Portal</p>
      </div>

      <nav className="mt-8 flex flex-1 flex-col gap-1">
        {NAV_ITEMS.map(({ key, label, icon: Icon }) => {
          const isActive = active === key
          return (
            <button
              key={key}
              onClick={() => onSelect(key)}
              onMouseEnter={() => setHover(key)}
              onMouseLeave={() => setHover(null)}
              className={clsx(
                'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-electric/10 text-electric'
                  : hover === key
                    ? 'bg-white/5 text-ink'
                    : 'text-ink-muted',
              )}
            >
              <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
              {label}
            </button>
          )
        })}
      </nav>

      <div className="mt-auto flex items-center gap-3 rounded-xl border border-border bg-surface/50 px-3 py-3">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald to-electric text-sm font-semibold text-slate-950">
          {(user?.name ?? 'P').charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1 text-sm leading-tight">
          <p className="truncate font-semibold text-ink">{user?.name ?? 'Dr. Physio'}</p>
          <p className="truncate text-xs text-ink-faint">{user?.email ?? 'physio@clinic.com'}</p>
        </div>
        <button
          onClick={() => {
            signOut()
            navigate('/login')
          }}
          className="flex-shrink-0 rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-white/5 hover:text-crimson"
          aria-label="Sign out"
          title="Sign out"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </aside>
  )
}
