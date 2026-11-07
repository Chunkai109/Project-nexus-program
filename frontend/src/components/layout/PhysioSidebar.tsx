import { Users, Dumbbell, Settings, LogOut, Menu, X, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { Logo } from './Logo'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { HoverExplain } from '@/components/ui/HoverExplain'
import { useAuth } from '@/lib/AuthContext'
import { useNavigate } from 'react-router-dom'
import { clsx } from 'clsx'
import { useEffect, useState } from 'react'

const COLLAPSED_KEY = 'smartphysio:sidebar-collapsed'

const NAV_ITEMS = [
  { key: 'roster', label: 'Patient Roster', icon: Users, explanation: 'View every patient who has signed in and drill into their session history.' },
  { key: 'creator', label: 'Exercise Creator', icon: Dumbbell, explanation: 'Build new exercise protocols and review existing ones.' },
  { key: 'settings', label: 'Settings', icon: Settings, explanation: 'Practice preferences and account configuration.' },
] as const

function SidebarNav({ active, onSelect, collapsed = false }: { active: string; onSelect: (key: string) => void; collapsed?: boolean }) {
  const [hover, setHover] = useState<string | null>(null)

  return (
    <nav className="mt-8 flex flex-1 flex-col gap-1">
      {NAV_ITEMS.map(({ key, label, icon: Icon, explanation }) => {
        const isActive = active === key
        return (
          <HoverExplain key={key} explanation={explanation}>
            <button
              onClick={() => onSelect(key)}
              aria-label={collapsed ? label : undefined}
              aria-current={isActive ? 'page' : undefined}
              title={collapsed ? label : undefined}
              onMouseEnter={() => setHover(key)}
              onMouseLeave={() => setHover(null)}
              className={clsx(
                'flex w-full items-center gap-3 rounded-xl py-2.5 text-sm font-medium transition-colors duration-200',
                collapsed ? 'justify-center px-0' : 'px-3',
                isActive
                  ? 'bg-accent/10 text-accent'
                  : hover === key
                    ? 'bg-surface-secondary text-ink'
                    : 'text-ink-muted',
              )}
            >
              <Icon className="h-[18px] w-[18px] flex-shrink-0" strokeWidth={2} />
              {!collapsed && label}
            </button>
          </HoverExplain>
        )
      })}
    </nav>
  )
}

function SidebarFooter({ collapsed = false }: { collapsed?: boolean }) {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  if (collapsed) {
    return (
      <div className="mt-auto flex flex-col items-center gap-2">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-sm font-semibold text-white"
          title={`${user?.name ?? 'Dr. Physio'} · ${user?.email ?? ''}`}
        >
          {(user?.name ?? 'P').charAt(0).toUpperCase()}
        </div>
        <button
          onClick={() => {
            signOut()
            navigate('/login')
          }}
          className="rounded-full p-1.5 text-ink-faint transition-colors duration-200 hover:bg-surface-hover hover:text-crimson"
          aria-label="Sign out"
          title="Sign out"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    )
  }

  return (
    <div className="mt-auto flex items-center gap-3 rounded-xl bg-surface-secondary px-3 py-3">
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-white">
        {(user?.name ?? 'P').charAt(0).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1 text-sm leading-tight">
        <p className="truncate font-semibold text-ink">{user?.name ?? 'Dr. Physio'}</p>
        <p className="truncate text-xs text-ink-faint">{user?.email ?? 'physio@clinic.com'}</p>
      </div>
      <HoverExplain explanation="Sign out of the Physiotherapist Portal and return to the login screen.">
        <button
          onClick={() => {
            signOut()
            navigate('/login')
          }}
          className="flex-shrink-0 rounded-full p-1.5 text-ink-faint transition-colors duration-200 hover:bg-surface-hover hover:text-crimson"
          aria-label="Sign out"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </HoverExplain>
    </div>
  )
}

/**
 * Persistent left sidebar on large screens; below `lg` it collapses into a
 * compact top bar with a hamburger button that opens the same nav as a
 * slide-in drawer, since a fixed 256px-wide column would eat most of a
 * phone screen otherwise.
 */
export function PhysioSidebar({
  active,
  onSelect,
}: {
  active: string
  onSelect: (key: string) => void
}) {
  const [mobileOpen, setMobileOpen] = useState(false)
  // Remembered per browser; a convenience only, so storage errors are ignored.
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(COLLAPSED_KEY) === '1'
    } catch {
      return false
    }
  })
  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0')
    } catch {
      // Storage blocked: the choice just won't be remembered.
    }
  }, [collapsed])

  function selectAndClose(key: string) {
    onSelect(key)
    setMobileOpen(false)
  }

  return (
    <>
      <header className="flex items-center justify-between border-b border-border bg-surface px-4 py-3 lg:hidden">
        <button
          onClick={() => setMobileOpen(true)}
          className="rounded-full p-2 text-ink-muted transition-colors duration-200 hover:bg-surface-secondary hover:text-ink"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <Logo size="sm" />
        <ThemeToggle />
      </header>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <aside className="relative flex h-full w-72 max-w-[80vw] flex-col bg-surface px-4 py-6 shadow-ambient-lg">
            <div className="flex items-center justify-between px-2">
              <div>
                <Logo size="sm" />
                <p className="mt-1 pl-0.5 text-xs text-ink-faint">Physiotherapist Portal</p>
              </div>
              <button
                onClick={() => setMobileOpen(false)}
                className="rounded-full p-2 text-ink-muted transition-colors duration-200 hover:bg-surface-secondary hover:text-ink"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <SidebarNav active={active} onSelect={selectAndClose} />
            <SidebarFooter />
          </aside>
        </div>
      )}

      <aside
        className={clsx(
          'sticky top-0 hidden h-screen flex-shrink-0 flex-col border-r border-border bg-surface py-6 transition-[width] duration-200 lg:flex',
          collapsed ? 'w-[72px] px-3' : 'w-64 px-4',
        )}
      >
        {collapsed ? (
          <div className="flex flex-col items-center gap-3">
            <Logo size="sm" iconOnly />
            <ThemeToggle />
          </div>
        ) : (
          <div className="flex items-center justify-between px-2">
            <div>
              <Logo size="sm" />
              <p className="mt-1 pl-0.5 text-xs text-ink-faint">Physiotherapist Portal</p>
            </div>
            <ThemeToggle />
          </div>
        )}
        <SidebarNav active={active} onSelect={onSelect} collapsed={collapsed} />
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}
          title={collapsed ? 'Expand menu' : 'Collapse menu'}
          className={clsx(
            'mb-3 flex items-center gap-3 rounded-xl py-2.5 text-sm font-medium text-ink-muted transition-colors duration-200 hover:bg-surface-secondary hover:text-ink',
            collapsed ? 'justify-center px-0' : 'px-3',
          )}
        >
          {collapsed ? <PanelLeftOpen className="h-[18px] w-[18px]" /> : <PanelLeftClose className="h-[18px] w-[18px]" />}
          {!collapsed && 'Collapse menu'}
        </button>
        <SidebarFooter collapsed={collapsed} />
      </aside>
    </>
  )
}
