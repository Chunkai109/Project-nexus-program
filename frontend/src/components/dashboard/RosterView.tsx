import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown, UserRound, X } from 'lucide-react'
import { clsx } from 'clsx'
import { Button } from '@/components/ui/Button'
import { formatRelativeTime } from '@/lib/formatRelativeTime'
import { PLACEHOLDER_RULES, RULES_ARE_PLACEHOLDERS } from '@/lib/dashboardRules'
import { byStatusThenRecent, type RosterRow, type RosterStatus } from './physioModel'
import { StatusPill } from './ui/StatusPill'
import { STATUS_META } from './ui/statusMeta'
import { SearchBox } from './ui/SearchBox'
import { Sparkline } from './ui/Sparkline'
import { EmptyState, ErrorState, Skeleton } from './ui/States'

type SortKey = 'status' | 'patient' | 'last' | 'goodForm' | 'inRange' | 'drift'
type Sort = { key: SortKey; dir: 'asc' | 'desc' }

const CHIP_ORDER: RosterStatus[] = ['needs-attention', 'check-camera', 'inactive', 'on-track']

function compare(key: SortKey, a: RosterRow, b: RosterRow): number {
  const num = (v: number | null | undefined) => (v == null ? -1 : v)
  switch (key) {
    case 'status':
      return byStatusThenRecent(a, b)
    case 'patient':
      return a.patient.name.localeCompare(b.patient.name)
    case 'last':
      return (a.latest?.session.completedAt ?? 0) - (b.latest?.session.completedAt ?? 0)
    case 'goodForm':
      return num(a.latest?.goodFormPct) - num(b.latest?.goodFormPct)
    case 'inRange':
      return num(a.latest?.inRangePct) - num(b.latest?.inRangePct)
    case 'drift':
      return num(a.latest?.driftFaults) - num(b.latest?.driftFaults)
  }
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  const first = words[0].charAt(0)
  const last = words.length > 1 ? words[words.length - 1].charAt(0) : ''
  return (first + last).toUpperCase()
}

/** Initials in a neutral circle. Colour is kept for status only. */
export function Initial({ name, size = 'md' }: { name: string; size?: 'md' | 'lg' }) {
  return (
    <span
      aria-hidden
      className={clsx(
        'flex flex-shrink-0 items-center justify-center rounded-full bg-surface-secondary font-semibold text-ink-muted',
        size === 'lg' ? 'h-12 w-12 text-[18px]' : 'h-9 w-9 text-[14px]',
      )}
    >
      {initials(name)}
    </span>
  )
}

export function GoodFormChangeShort({ change }: { change: number }) {
  if (change === 0) return <span className="text-ink-muted">No change</span>
  const size = Math.abs(change)
  return (
    <span className={clsx('font-medium', change > 0 ? 'text-emerald-ink' : 'text-crimson-ink')}>
      {change > 0 ? '▲' : '▼'} {size} {size === 1 ? 'pt' : 'pts'}
    </span>
  )
}

function SortHeader({ label, k, sort, onSort, className }: { label: string; k: SortKey; sort: Sort; onSort: (k: SortKey) => void; className?: string }) {
  const active = sort.key === k
  const Icon = !active ? ChevronsUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown
  return (
    <th scope="col" aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={clsx('sticky top-14 z-10 border-b border-border bg-surface px-3 py-0 text-left first:pl-5', className)}>
      <button type="button" onClick={() => onSort(k)} className="inline-flex min-h-[44px] items-center gap-1 whitespace-nowrap text-[13px] font-semibold text-ink-muted hover:text-ink">
        {label}
        <Icon className={clsx('h-3.5 w-3.5', active ? 'text-ink' : 'text-ink-faint')} aria-hidden />
      </button>
    </th>
  )
}

function Cell({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <td className={clsx('border-b border-border px-3 py-3 align-top text-[14px] first:pl-5 last:pr-5', className)} title={title}>
      {children}
    </td>
  )
}

const dash = <span className="text-ink-muted">—</span>

export function RosterSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading patients…" className="surface-panel rounded-2xl p-5">
      <div className="mb-4 flex gap-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-9 w-36 rounded-full" />
        ))}
      </div>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex items-center gap-4 border-b border-border py-3 last:border-0">
          <Skeleton className="h-9 w-9 rounded-full" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="ml-auto h-6 w-20" />
        </div>
      ))}
    </div>
  )
}

/**
 * The Patients list. Pure view: rows come in as props (real data from the
 * container, or demo data on /demo/physio/roster).
 */
export function RosterView({
  rows,
  loading = false,
  error = null,
  onRetry,
  onOpen,
}: {
  rows: RosterRow[]
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  onOpen: (patientId: string) => void
}) {
  const [filter, setFilter] = useState<RosterStatus | null>(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>({ key: 'status', dir: 'asc' })

  const counts = useMemo(() => {
    const c: Record<RosterStatus, number> = { 'needs-attention': 0, 'check-camera': 0, inactive: 0, 'on-track': 0 }
    for (const r of rows) c[r.status] += 1
    return c
  }, [rows])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = rows.filter((r) => (!filter || r.status === filter) && (!q || r.patient.name.toLowerCase().includes(q) || r.patient.email.toLowerCase().includes(q)))
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...list].sort((a, b) => compare(sort.key, a, b) * dir || byStatusThenRecent(a, b))
  }, [rows, filter, query, sort])

  function onSort(k: SortKey) {
    setSort((s) => (s.key === k ? { key: k, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: k === 'patient' || k === 'status' ? 'asc' : 'desc' }))
  }

  if (error) return <ErrorState message={error} onRetry={onRetry} />
  if (loading) return <RosterSkeleton />
  if (rows.length === 0) return <EmptyState icon={UserRound} message="No patients yet. Patients appear here after their first sign-in." />

  const { goodFormBelowPct, driftFaultsAtLeast } = PLACEHOLDER_RULES.needsAttention

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-2">
          {CHIP_ORDER.map((s) => {
            const meta = STATUS_META[s]
            const Icon = meta.icon
            const on = filter === s
            return (
              <button
                key={s}
                type="button"
                aria-pressed={on}
                onClick={() => setFilter(on ? null : s)}
                className={clsx(
                  'inline-flex min-h-[40px] items-center gap-1.5 rounded-full border px-3.5 text-[14px] font-semibold transition-colors duration-150',
                  on ? 'border-accent bg-accent/10 text-ink' : 'border-border-strong bg-surface text-ink hover:bg-surface-secondary',
                )}
              >
                <Icon className={clsx('h-4 w-4', meta.text)} aria-hidden />
                <span>
                  {meta.label} · <span className="tabular-nums">{counts[s]}</span>
                </span>
                {on && <X className="h-3.5 w-3.5 text-ink-muted" aria-hidden />}
              </button>
            )
          })}
        </div>
        <SearchBox value={query} onChange={setQuery} label="Search patients" className="ml-auto w-full sm:w-72" />
      </div>

      <div className="surface-panel rounded-2xl">
        <table className="w-full table-fixed border-separate border-spacing-0">
          <caption className="sr-only">Patients, sorted so whoever needs you most is first. Press Enter on a row to open that patient.</caption>
          <colgroup>
            <col className="w-[24%]" />
            <col className="w-[22%]" />
            <col className="w-[14%]" />
            <col className="w-[13%]" />
            <col className="hidden w-[9%] lg:table-column" />
            <col className="hidden w-[10%] md:table-column" />
            <col className="hidden w-[110px] lg:table-column" />
          </colgroup>
          <thead>
            <tr>
              <SortHeader label="Patient" k="patient" sort={sort} onSort={onSort} />
              <SortHeader label="Status" k="status" sort={sort} onSort={onSort} />
              <SortHeader label="Last session" k="last" sort={sort} onSort={onSort} />
              <SortHeader label="Good form" k="goodForm" sort={sort} onSort={onSort} />
              <SortHeader label="In range" k="inRange" sort={sort} onSort={onSort} className="hidden lg:table-cell" />
              <SortHeader label="Drift faults" k="drift" sort={sort} onSort={onSort} className="hidden md:table-cell" />
              <th scope="col" className="sticky top-14 z-10 hidden border-b border-border bg-surface px-3 pr-5 text-left text-[13px] font-semibold text-ink-muted lg:table-cell">
                Trend
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const l = r.latest
              const open = () => onOpen(r.patient.id)
              return (
                <tr
                  key={r.patient.id}
                  tabIndex={0}
                  aria-label={`Open ${r.patient.name}'s page. ${STATUS_META[r.status].label}${r.reason ? `, ${r.reason}` : ''}.`}
                  onClick={open}
                  onKeyDown={(e: KeyboardEvent) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      open()
                    }
                  }}
                  className="cursor-pointer transition-colors duration-100 hover:bg-surface-secondary focus-visible:bg-surface-secondary [&:last-child>td]:border-b-0"
                >
                  <Cell>
                    <span className="flex min-w-0 items-center gap-3">
                      <Initial name={r.patient.name} />
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-ink" title={r.patient.name}>
                          {r.patient.name}
                        </span>
                        <span className="block truncate text-[13px] text-ink-muted" title={r.patient.email}>
                          {r.patient.email}
                        </span>
                      </span>
                    </span>
                  </Cell>
                  <Cell>
                    <StatusPill status={r.status} reason={r.reason} />
                  </Cell>
                  <Cell>
                    {l ? (
                      <>
                        <span className="block text-ink">{formatRelativeTime(l.session.completedAt)}</span>
                        <span className="block truncate text-[13px] text-ink-muted" title={l.session.exerciseTitle}>
                          {l.session.exerciseTitle}
                        </span>
                      </>
                    ) : (
                      dash
                    )}
                  </Cell>
                  <Cell>
                    {!l ? (
                      dash
                    ) : l.goodFormPct === null ? (
                      <>
                        {dash}
                        <span className="block text-[13px] text-ink-muted">{l.unscored} not scored</span>
                      </>
                    ) : (
                      <>
                        <span className="font-semibold tabular-nums text-ink">{l.goodFormPct}%</span>
                        {r.goodFormChange !== null && (
                          <span className="ml-2 text-[13px]">
                            <GoodFormChangeShort change={r.goodFormChange} />
                          </span>
                        )}
                        <span className="block text-[13px] tabular-nums text-ink-muted">{l.unscored} not scored</span>
                      </>
                    )}
                  </Cell>
                  <Cell className="hidden tabular-nums lg:table-cell">{l?.inRangePct == null ? dash : `${l.inRangePct}%`}</Cell>
                  <Cell className="hidden tabular-nums md:table-cell">{l ? l.driftFaults : dash}</Cell>
                  <Cell className="hidden lg:table-cell">
                    <Sparkline values={r.trend} label={`Good form over the last ${r.trend.length} sessions of ${l?.session.exerciseTitle ?? 'this exercise'}: ${r.trend.map((v) => (v === null ? 'not scored' : `${v}%`)).join(', ')}`} />
                  </Cell>
                </tr>
              )
            })}
          </tbody>
        </table>
        {shown.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <p className="text-[15px] text-ink">{query ? 'No patient matches that search. Clear the search to see everyone.' : 'No patients match this filter.'}</p>
            <Button
              variant="secondary"
              onClick={() => {
                setQuery('')
                setFilter(null)
              }}
            >
              Clear filter
            </Button>
          </div>
        )}
      </div>

      {RULES_ARE_PLACEHOLDERS && (
        <p className="mt-3 max-w-[110ch] text-[13px] leading-relaxed text-ink-muted">
          <span className="font-semibold text-amber-ink">Placeholder rules</span> until a physiotherapist confirms them. <b className="text-ink">Needs attention</b> if the last
          session had {driftFaultsAtLeast} or more drift faults or good form under {goodFormBelowPct}%. <b className="text-ink">Check camera</b> if the AI scored half the
          reps or fewer. <b className="text-ink">Inactive</b> after {PLACEHOLDER_RULES.inactiveAfterDays} days without a session. Good form is reps the AI scored{' '}
          {PLACEHOLDER_RULES.goodFormVerdicts.join(' or ')}, out of the reps it scored.
        </p>
      )}
    </div>
  )
}

