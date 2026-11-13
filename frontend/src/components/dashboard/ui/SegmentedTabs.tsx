import { useRef, type KeyboardEvent } from 'react'
import { clsx } from 'clsx'

/** A two-or-more option segmented control that is a proper tablist: arrow keys, Home and End move between tabs. */
export function SegmentedTabs<K extends string>({
  tabs,
  value,
  onChange,
  label,
  idPrefix,
}: {
  tabs: { key: K; label: string }[]
  value: K
  onChange: (key: K) => void
  label: string
  idPrefix: string
}) {
  const refs = useRef<Partial<Record<K, HTMLButtonElement | null>>>({})
  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    const i = tabs.findIndex((t) => t.key === value)
    const next =
      e.key === 'ArrowRight' ? tabs[(i + 1) % tabs.length] : e.key === 'ArrowLeft' ? tabs[(i - 1 + tabs.length) % tabs.length] : e.key === 'Home' ? tabs[0] : e.key === 'End' ? tabs[tabs.length - 1] : null
    if (!next) return
    e.preventDefault()
    refs.current[next.key]?.focus()
    onChange(next.key)
  }
  return (
    <div role="tablist" aria-label={label} className="inline-flex rounded-xl bg-surface-secondary p-1">
      {tabs.map((t) => {
        const selected = t.key === value
        return (
          <button
            key={t.key}
            ref={(el) => {
              refs.current[t.key] = el
            }}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${t.key}`}
            aria-selected={selected}
            aria-controls={`${idPrefix}-tabpanel-${t.key}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.key)}
            onKeyDown={onKeyDown}
            className={clsx(
              'min-h-[40px] rounded-lg px-4 text-[14px] font-semibold transition-colors duration-150',
              selected ? 'bg-surface text-ink shadow-[var(--shadow-ambient)]' : 'text-ink-muted hover:text-ink',
            )}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}
