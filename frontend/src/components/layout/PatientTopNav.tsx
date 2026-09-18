import { Bluetooth, BatteryMedium, LogOut } from 'lucide-react'
import { Logo } from './Logo'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { useAuth } from '@/lib/AuthContext'
import { useNavigate } from 'react-router-dom'

export function PatientTopNav({
  weeklyDone,
  weeklyTotal,
  battery = 92,
  bleConnected = true,
}: {
  weeklyDone: number
  weeklyTotal: number
  battery?: number
  bleConnected?: boolean
}) {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  return (
    <header className="flex items-center justify-between gap-6 border-b border-border px-8 py-5">
      <Logo size="sm" />

      <div className="flex items-center gap-3 rounded-xl border border-border bg-surface/60 px-4 py-2">
        <div className="flex items-center gap-2 text-sm">
          <span className={bleConnected ? 'relative flex h-2 w-2' : 'flex h-2 w-2'}>
            {bleConnected && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald opacity-75" />
            )}
            <span className={`relative inline-flex h-2 w-2 rounded-full ${bleConnected ? 'bg-emerald' : 'bg-crimson'}`} />
          </span>
          <Bluetooth className="h-4 w-4 text-electric" />
          <span className="text-ink-muted">{bleConnected ? 'ESP32 Connected' : 'ESP32 Disconnected'}</span>
        </div>
        <div className="h-4 w-px bg-border" />
        <div className="flex items-center gap-1.5 text-sm text-ink-muted">
          <BatteryMedium className="h-4 w-4 text-emerald" />
          {battery}%
        </div>
      </div>

      <div className="flex items-center gap-5">
        <div className="hidden min-w-[180px] flex-col gap-1.5 sm:flex">
          <div className="flex items-center justify-between text-xs">
            <span className="text-ink-muted">Weekly Progress</span>
            <span className="font-medium text-ink">
              {weeklyDone}/{weeklyTotal} Sessions
            </span>
          </div>
          <ProgressBar value={weeklyDone} max={weeklyTotal} tone="emerald" />
        </div>

        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-electric to-violet text-sm font-semibold text-slate-950">
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
            className="ml-1 rounded-lg p-2 text-ink-faint transition-colors hover:bg-white/5 hover:text-crimson"
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
