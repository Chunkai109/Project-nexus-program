import { LogOut, Wifi, WifiOff } from 'lucide-react'
import { Logo } from '@/components/layout/Logo'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { PatientContainer } from './PatientContainer'

export type HubState = 'connected' | 'connecting' | 'disconnected' | 'error'

const HUB_WORDS: Record<HubState, string> = {
  connected: 'Hub connected',
  connecting: 'Connecting to hub…',
  disconnected: 'Hub not connected',
  error: 'Hub not found',
}

/** Hub status as icon + words. Shows only what the hub really reports. */
export function HubChip({ state }: { state: HubState }) {
  const on = state === 'connected'
  const Icon = on || state === 'connecting' ? Wifi : WifiOff
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-[14px] font-semibold ${
        on ? 'bg-emerald/10 text-emerald-ink' : 'bg-surface-secondary text-ink-muted'
      }`}
    >
      <Icon className="h-4 w-4" aria-hidden />
      {HUB_WORDS[state]}
    </span>
  )
}

/** Top bar for the patient's home screens (exercise list, past sessions). */
export function PatientHeader({
  userName,
  hubState,
  sessionsThisWeek,
  onSignOut,
}: {
  userName: string
  hubState: HubState
  sessionsThisWeek: number
  onSignOut?: () => void
}) {
  return (
    <header className="translucent-header sticky top-0 z-20 border-b border-border">
      <PatientContainer className="flex flex-wrap items-center justify-between gap-3 py-3">
      <Logo size="sm" />
      <div className="flex flex-wrap items-center gap-3">
        <HubChip state={hubState} />
        <span className="hidden text-[14px] text-ink-muted md:inline">
          <span className="font-semibold text-ink">{sessionsThisWeek}</span> session{sessionsThisWeek === 1 ? '' : 's'} this week
        </span>
      </div>
      <div className="flex items-center gap-2.5">
        <ThemeToggle />
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-ink" aria-hidden>
          {userName.charAt(0).toUpperCase()}
        </span>
        <span className="hidden text-[15px] font-semibold text-ink sm:inline">{userName}</span>
        {onSignOut && (
          <button
            type="button"
            onClick={onSignOut}
            className="rounded-full p-2 text-ink-muted transition-colors duration-200 hover:bg-surface-secondary hover:text-crimson-ink"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="h-[18px] w-[18px]" />
          </button>
        )}
      </div>
      </PatientContainer>
    </header>
  )
}

const FLOW_STEPS = [{ label: 'Sensors' }, { label: 'Check' }, { label: 'Exercise' }]

/** Top bar for the three in-session screens: where you are in the flow. */
export function SessionHeader({ step, right, wide = false }: { step: 0 | 1 | 2; right?: React.ReactNode; wide?: boolean }) {
  return (
    <header className="translucent-header sticky top-0 z-20 border-b border-border">
      <PatientContainer wide={wide} className="flex items-center justify-between gap-3 py-3">
      <Logo size="sm" />
      <Breadcrumb steps={FLOW_STEPS} activeIndex={step} />
      <div className="flex items-center gap-3">
        {right}
        <ThemeToggle />
      </div>
      </PatientContainer>
    </header>
  )
}
