import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Dumbbell, LogOut, Menu, Settings, Users, X } from 'lucide-react'
import { clsx } from 'clsx'
import { Logo } from './Logo'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { useAuth } from '@/lib/AuthContext'

const NAV_ITEMS = [
  { key: 'roster', label: 'Patient Roster', icon: Users, hint: 'Who needs you first' },
  { key: 'creator', label: 'Exercise Creator', icon: Dumbbell, hint: 'Preset exercises' },
  { key: 'settings', label: 'Settings', icon: Settings, hint: 'Practice preferences' },
] as const

/** Pages inside a section highlight that section, e.g. a patient's page highlights Patient Roster. */
function sectionOf(tab: string): string {
  if (tab === 'analytics') return 'roster'
  if (tab.startsWith('exercise-')) return 'creator'
  return tab
}

/** Short name of the current page, shown after the logo like GitHub's "owner / repo". */
function pageName(tab: string): string {
  if (tab === 'analytics') return 'Patient'
  if (tab === 'exercise-analytics') return 'Exercise analytics'
  if (tab === 'exercise-finetune') return 'Edit exercise'
  return NAV_ITEMS.find((n) => n.key === tab)?.label ?? ''
}

function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={clsx('flex flex-shrink-0 items-center justify-center rounded-full bg-accent font-semibold text-white', className)}
      aria-hidden
    >
      {name.charAt(0).toUpperCase()}
    </span>
  )
}

/**
 * GitHub-style navigation: a slim top bar with a menu button, and a drawer
 * that slides over the page from the left. The page underneath keeps the
 * full width at every screen size.
 */
export function PhysioSidebar({ active, onSelect }: { active: string; onSelect: (key: string) => void }) {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const section = sectionOf(active)
  const current = NAV_ITEMS.find((n) => n.key === section)
  const name = user?.name ?? 'Dr. Physio'

  // Focus moves into the drawer when it opens and back to the menu button when it closes; Esc closes it.
  useEffect(() => {
    if (!open) return
    closeButtonRef.current?.focus()
    const menuButton = menuButtonRef.current
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      menuButton?.focus()
    }
  }, [open])

  function go(key: string) {
    onSelect(key)
    setOpen(false)
  }

  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 flex-shrink-0 items-center gap-3 border-b border-border bg-surface px-4 sm:px-6">
        <button
          ref={menuButtonRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          aria-expanded={open}
          aria-controls="physio-nav-drawer"
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-border-strong text-ink-muted transition-colors duration-200 hover:bg-surface-secondary hover:text-ink"
        >
          <Menu className="h-[18px] w-[18px]" />
        </button>
        <button type="button" onClick={() => go('roster')} aria-label="SmartPhysio home" className="flex-shrink-0">
          <Logo size="sm" />
        </button>
        {pageName(active) && (
          <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-2 text-[14px] sm:flex">
            <span className="text-ink-faint">/</span>
            {current && section !== active ? (
              <>
                <button type="button" onClick={() => go(section)} className="truncate text-ink-muted hover:text-ink hover:underline">
                  {current.label}
                </button>
                <span className="text-ink-faint">/</span>
                <span className="truncate font-semibold text-ink">{pageName(active)}</span>
              </>
            ) : (
              <span className="truncate font-semibold text-ink">{pageName(active)}</span>
            )}
          </nav>
        )}
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <span title={`${name} · ${user?.email ?? ''}`}>
            <Avatar name={name} className="h-8 w-8 text-[13px]" />
          </span>
        </div>
      </header>

      {open &&
        createPortal(
          <div className="fixed inset-0 z-40">
            <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
            <aside
              id="physio-nav-drawer"
              role="dialog"
              aria-modal="true"
              aria-label="Main menu"
              className="absolute inset-y-0 left-0 flex w-80 max-w-[85vw] flex-col bg-surface shadow-[var(--shadow-ambient-lg)]"
            >
              <div className="flex items-start justify-between px-5 pt-5">
                <div>
                  <Logo size="sm" />
                  <p className="mt-1 pl-0.5 text-xs text-ink-faint">Physiotherapist Portal</p>
                </div>
                <button
                  ref={closeButtonRef}
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close menu"
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-border-strong text-ink-muted transition-colors duration-200 hover:bg-surface-secondary hover:text-ink"
                >
                  <X className="h-[18px] w-[18px]" />
                </button>
              </div>

              <nav aria-label="Main" className="mt-6 flex flex-col gap-0.5 px-3">
                {NAV_ITEMS.map(({ key, label, icon: Icon, hint }) => {
                  const selected = key === section
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => go(key)}
                      aria-current={selected ? 'page' : undefined}
                      title={hint}
                      className={clsx(
                        'relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[14px] transition-colors duration-150',
                        selected ? 'bg-surface-secondary font-semibold text-ink' : 'text-ink-muted hover:bg-surface-secondary hover:text-ink',
                      )}
                    >
                      {selected && <span className="absolute -left-3 top-1.5 bottom-1.5 w-1 rounded-r bg-accent" aria-hidden />}
                      <Icon className="h-[18px] w-[18px] flex-shrink-0" strokeWidth={2} />
                      {label}
                    </button>
                  )
                })}
              </nav>

              <div className="mt-auto border-t border-border px-5 py-4">
                <div className="flex items-center gap-3">
                  <Avatar name={name} className="h-9 w-9 text-sm" />
                  <div className="min-w-0 flex-1 text-sm leading-tight">
                    <p className="truncate font-semibold text-ink">{name}</p>
                    <p className="truncate text-xs text-ink-faint">{user?.email ?? 'physio@clinic.com'}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      signOut()
                      navigate('/login')
                    }}
                    className="flex-shrink-0 rounded-full p-1.5 text-ink-faint transition-colors duration-200 hover:bg-surface-hover hover:text-crimson"
                    aria-label="Sign out"
                    title="Sign out"
                  >
                    <LogOut className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </aside>
          </div>,
          document.body,
        )}
    </>
  )
}
