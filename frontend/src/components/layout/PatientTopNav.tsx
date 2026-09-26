import { Wifi, BatteryMedium, LogOut } from 'lucide-react'
import { Logo } from './Logo'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { useAuth } from '@/lib/AuthContext'
import { useNavigate } from 'react-router-dom'

export function PatientTopNav({
  weeklyDone,
  weeklyTotal,
  battery = 92,
  hubConnected = true,
}: {
  weeklyDone: number
  weeklyTotal: number
  battery?: number
  hubConnected?: boolean
}) {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  return (
    <header className="translucent-header sticky top-0 z-20 flex items-center justify-between gap-1.5 border-b border-border px-3 py-3 sm:gap-4 sm:px-6 sm:py-4 lg:gap-6 lg:px-8">
      <Logo size="sm" />

      <div className="flex items-center gap-1 rounded-full bg-surface-secondary px-2 py-1.5 sm:gap-3 sm:px-4 sm:py-2">
        <div className="flex items-center gap-1 text-sm sm:gap-2">
          <span className={hubConnected ? 'relative flex h-2 w-2' : 'flex h-2 w-2'}>
            {hubConnected && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald opacity-75" />
            )}
            <span className={`relative inline-flex h-2 w-2 rounded-full ${hubConnected ? 'bg-emerald' : 'bg-crimson'}`} />
          </span>
          <Wifi className="h-4 w-4 text-ink-muted" />
          <span className="hidden text-ink-muted sm:inline">{hubConnected ? 'ESP32 Connected' : 'ESP32 Disconnected'}</span>
        </div>
        <div className="hidden h-4 w-px bg-border-strong sm:block" />
        <div className="flex items-center gap-1 text-sm text-ink-muted">
          <BatteryMedium className="h-4 w-4" />
          {battery}%
        </div>
      </div>

      <div className="flex items-center gap-1.5 sm:gap-3 lg:gap-5">
        <div className="hidden min-w-[180px] flex-col gap-1.5 lg:flex">
          <div className="flex items-center justify-between text-xs">
            <span className="text-ink-muted">Weekly Progress</span>
            <span className="font-medium text-ink">
              {weeklyDone}/{weeklyTotal} Sessions
            </span>
          </div>
          <ProgressBar value={weeklyDone} max={weeklyTotal} tone="emerald" />
        </div>

        <div className="flex items-center gap-1.5 sm:gap-3">
          <ThemeToggle />
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-white">
            {(user?.name ?? 'A').charAt(0).toUpperCase()}
          </div>
          <div className="hidden text-sm leading-tight md:block">
            <p className="text-ink-muted">Welcome back,</p>
            <p className="font-semibold text-ink">{user?.name ?? 'Alex'}</p>
          </div>
          <button
            onClick={() => {
              signOut()
              navigate('/login')
            }}
            className="rounded-full p-1.5 text-ink-faint transition-colors duration-200 hover:bg-surface-secondary hover:text-crimson sm:ml-1 sm:p-2"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
  )
}
