import type { ReactNode } from 'react'
import { clsx } from 'clsx'
import { Card } from '@/components/ui/Card'

export interface ExerciseListItem {
  id: string
  title: string
  detail: string
}

export interface ExerciseListSection {
  /** Small heading above the section, e.g. "Earlier exercises". Omit for the main list. */
  label?: string
  items: ExerciseListItem[]
}

/**
 * The left-hand exercise list used by both patient tabs: a 4-column list on
 * wide screens, a wrapping row of chips below 1024px. Render it as the first
 * child of a `lg:grid-cols-12` grid; the detail goes in `lg:col-span-8`.
 */
export function ExerciseListPanel({
  title,
  sections,
  selectedId,
  onSelect,
  emptyText,
  footer,
  ariaLabel,
}: {
  title: string
  sections: ExerciseListSection[]
  selectedId: string | null | undefined
  onSelect: (id: string) => void
  emptyText: string
  footer?: ReactNode
  ariaLabel: string
}) {
  const all = sections.flatMap((s) => s.items)
  return (
    <>
      <Card className="hidden self-start p-5 lg:col-span-4 lg:block">
        <p className="mb-3 text-[15px] font-semibold text-ink">{title}</p>
        {all.length === 0 ? (
          <p className="rounded-xl bg-surface-secondary p-4 text-center text-[13px] text-ink-muted">{emptyText}</p>
        ) : (
          sections
            .filter((s) => s.items.length > 0)
            .map((s, i) => (
              <div key={s.label ?? i} className={clsx(i > 0 && 'mt-4')}>
                {s.label && <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{s.label}</p>}
                <ul className="flex flex-col gap-1" aria-label={s.label ?? ariaLabel}>
                  {s.items.map((item) => {
                    const isSel = item.id === selectedId
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => onSelect(item.id)}
                          aria-current={isSel ? 'true' : undefined}
                          className={clsx(
                            'w-full rounded-r-lg border-l-[3px] px-3 py-2.5 text-left transition-colors duration-150',
                            isSel ? 'border-accent bg-accent/10' : 'border-transparent hover:bg-surface-secondary',
                          )}
                        >
                          <span className="block truncate text-[14px] font-semibold text-ink">{item.title}</span>
                          <span className="block text-[12px] tabular-nums text-ink-muted">{item.detail}</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))
        )}
        {footer && <div className="mt-4">{footer}</div>}
      </Card>

      <div className="flex flex-wrap items-center gap-2 lg:hidden" aria-label={ariaLabel}>
        {all.length === 0 && <span className="text-[13px] text-ink-muted">{emptyText}</span>}
        {all.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            aria-current={item.id === selectedId ? 'true' : undefined}
            className={clsx(
              'max-w-[220px] flex-shrink-0 truncate rounded-full px-3.5 py-1.5 text-[13px] font-medium',
              item.id === selectedId ? 'bg-accent/10 text-accent' : 'bg-surface-secondary text-ink-muted',
            )}
          >
            {item.title}
          </button>
        ))}
        {footer && <div className="flex-shrink-0">{footer}</div>}
      </div>
    </>
  )
}
