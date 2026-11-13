import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, ArrowRight, CheckCircle2, Loader2, LogOut, RefreshCw, Search, ShieldCheck, Stethoscope, UserRound } from 'lucide-react'
import { clsx } from 'clsx'
import { PageShell } from '@/components/layout/PageShell'
import { Logo } from '@/components/layout/Logo'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { useAuth } from '@/lib/AuthContext'
import { listAccounts, openClinic, setAccount, type AdminAccount } from '@/lib/admin'
import { DeveloperTools } from '@/components/admin/DeveloperTools'
import { PRACTICES } from '@/lib/mockData'

const ROLE = {
  patient: { label: 'Patient', icon: UserRound },
  physio: { label: 'Physiotherapist', icon: Stethoscope },
  admin: { label: 'Admin', icon: ShieldCheck },
} as const

type Filter = 'all' | 'patient' | 'physio' | 'admin'
type Pending = { account: AdminAccount; role: 'patient' | 'physio'; practiceId: string }

const clinicName = (id: string) => PRACTICES.find((p) => p.id === id)?.name ?? id

/**
 * The Admin page: every account with its role and clinic, and the one job an
 * admin has, which is to turn a patient account into a physiotherapist
 * account (or back) and put it in the right clinic. This tab shows no exercise or
 * session data. The Clinics tab opens a clinic's physio dashboard, and the
 * Developer tools tab has the team's pre-demo checks.
 */
export function AdminPage() {
  const { user, signOut, refreshUser } = useAuth()
  const navigate = useNavigate()
  const [accounts, setAccounts] = useState<AdminAccount[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [clinicDraft, setClinicDraft] = useState<Record<string, string>>({})
  const [pending, setPending] = useState<Pending | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [tab, setTab] = useState<'accounts' | 'clinics' | 'tools'>('accounts')
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)

  /** Opens a clinic: from then on the admin works in it like one of its physiotherapists. */
  async function open(practiceId: string) {
    setOpeningId(practiceId)
    setOpenError(null)
    const result = await openClinic(practiceId)
    if (!result.ok) {
      setOpeningId(null)
      setOpenError(result.error)
      return
    }
    await refreshUser()
    navigate('/physio')
  }

  const load = useCallback(async () => {
    setLoading(true)
    const result = await listAccounts()
    setLoading(false)
    if (result.ok) {
      setAccounts(result.value)
      setLoadError(null)
    } else setLoadError(result.error)
  }, [])

  useEffect(() => {
    // Loads the account list once when the page opens.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (accounts ?? []).filter((a) => (filter === 'all' || a.role === filter) && (!q || a.name.toLowerCase().includes(q) || a.email.toLowerCase().includes(q)))
  }, [accounts, query, filter])

  const counts = useMemo(() => {
    const c = { all: 0, patient: 0, physio: 0, admin: 0 }
    for (const a of accounts ?? []) {
      c.all++
      c[a.role]++
    }
    return c
  }, [accounts])

  async function apply(p: Pending) {
    setPending(null)
    setSavingId(p.account.id)
    setMessage(null)
    const result = await setAccount(p.account.id, p.role, p.practiceId)
    setSavingId(null)
    if (!result.ok) {
      setMessage({ tone: 'error', text: result.error })
      return
    }
    setMessage({ tone: 'ok', text: `${p.account.name} is now a ${ROLE[p.role].label.toLowerCase()} at ${clinicName(p.practiceId)}.` })
    await load()
  }

  const confirmText = pending
    ? pending.role === pending.account.role
      ? `Move ${pending.account.name} to ${clinicName(pending.practiceId)}?`
      : pending.role === 'physio'
        ? `Make ${pending.account.name} (${pending.account.email}) a physiotherapist at ${clinicName(pending.practiceId)}? They will see that clinic's patients and their sessions.`
        : `Change ${pending.account.name} (${pending.account.email}) back to a patient? They will no longer see any patients.`
    : ''

  return (
    <PageShell fullWidth>
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-[1100px] items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-3">
            <Logo />
            <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-secondary px-3 py-1 text-[14px] font-semibold text-ink-muted">
              <ShieldCheck className="h-4 w-4" aria-hidden />
              Admin
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden text-[15px] text-ink-muted sm:inline">{user?.email}</span>
            <ThemeToggle />
            <Button
              variant="secondary"
              size="sm"
              className="min-h-[40px] text-[15px]"
              onClick={() => {
                void signOut()
                navigate('/login')
              }}
            >
              <LogOut className="h-4 w-4" aria-hidden />
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1100px] px-6 py-8">
        <div role="tablist" aria-label="Admin sections" className="mb-6 flex gap-1 border-b border-border-strong">
          {([['accounts', 'Accounts'], ['clinics', 'Clinics'], ['tools', 'Developer tools']] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={clsx(
                '-mb-px min-h-[48px] border-b-2 px-4 text-[17px] font-semibold',
                tab === id ? 'border-accent text-accent' : 'border-transparent text-ink-muted hover:text-ink',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'tools' && (
          <>
            <h1 className="text-[28px] font-bold tracking-tight text-ink">Developer tools</h1>
            <p className="mb-6 mt-1 max-w-[60ch] text-[16px] text-ink-muted">Checks for the team before a demo. Nothing here reads or changes patient records.</p>
            <DeveloperTools />
          </>
        )}

        {tab === 'clinics' && (
          <>
            <h1 className="text-[28px] font-bold tracking-tight text-ink">Clinics</h1>
            <p className="mt-1 max-w-[62ch] text-[16px] text-ink-muted">
              Open a clinic to work in it like one of its physiotherapists: see its patients and sessions, and create, edit or delete its
              exercises and plans. For the prototype with test accounts only.
            </p>
            {openError && (
              <p role="alert" className="mt-4 flex items-start gap-2.5 rounded-xl bg-crimson/10 px-4 py-3 text-[16px] font-medium text-crimson-ink">
                <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0" aria-hidden />
                {openError}
              </p>
            )}
            <ul className="mt-5 flex flex-col gap-3">
              {PRACTICES.map((p) => {
                const inClinic = (accounts ?? []).filter((a) => a.practiceId === p.id && a.role !== 'admin')
                return (
                  <li key={p.id}>
                    <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
                      <div>
                        <p className="text-[18px] font-bold text-ink">{p.name}</p>
                        <p className="text-[15px] text-ink-muted">
                          {accounts === null
                            ? 'Loading accounts…'
                            : `${inClinic.filter((a) => a.role === 'physio').length} physiotherapists, ${inClinic.filter((a) => a.role === 'patient').length} patients`}
                        </p>
                      </div>
                      <Button className="min-h-[48px] text-[16px]" disabled={openingId !== null} onClick={() => void open(p.id)}>
                        {openingId === p.id ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <ArrowRight className="h-5 w-5" aria-hidden />}
                        {openingId === p.id ? 'Opening…' : 'Open clinic'}
                      </Button>
                    </Card>
                  </li>
                )
              })}
            </ul>
          </>
        )}

        {tab === 'accounts' && (
          <>
        <h1 className="text-[28px] font-bold tracking-tight text-ink">Accounts</h1>
        <p className="mt-1 max-w-[60ch] text-[16px] text-ink-muted">
          Everyone creates a patient account first. To set up a physiotherapist, find their account here
          and change it. To see a clinic's patients and plans, use the Clinics tab.
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <label className="relative block min-w-[240px] flex-1">
            <span className="sr-only">Search by name or email</span>
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-faint" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or email"
              className="h-12 w-full rounded-xl border border-ink-faint bg-surface pl-11 pr-4 text-[16px] text-ink placeholder:text-ink-faint"
            />
          </label>
          <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5">
            {(['all', 'patient', 'physio', 'admin'] as const).map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
                className={clsx(
                  'min-h-[40px] rounded-full px-3.5 text-[15px] font-semibold',
                  filter === f ? 'bg-accent/10 text-accent ring-1 ring-accent/40' : 'bg-surface-secondary text-ink-muted hover:text-ink',
                )}
              >
                {f === 'all' ? 'All' : `${ROLE[f].label}s`} ({counts[f]})
              </button>
            ))}
          </div>
          <Button variant="secondary" size="sm" className="min-h-[40px] text-[15px]" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={clsx('h-4 w-4', loading && 'animate-spin')} aria-hidden />
            Refresh list
          </Button>
        </div>

        <div aria-live="polite" className="mt-4 min-h-[1px]">
          {message && (
            <p
              role={message.tone === 'error' ? 'alert' : 'status'}
              className={clsx(
                'flex items-start gap-2.5 rounded-xl px-4 py-3 text-[16px] font-medium',
                message.tone === 'error' ? 'bg-crimson/10 text-crimson-ink' : 'bg-emerald/10 text-emerald-ink',
              )}
            >
              {message.tone === 'error' ? <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0" aria-hidden /> : <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0" aria-hidden />}
              {message.text}
            </p>
          )}
        </div>

        <Card className="mt-3 overflow-hidden">
          {loadError ? (
            <p role="alert" className="flex items-start gap-2.5 p-6 text-[16px] font-medium text-crimson-ink">
              <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0" aria-hidden />
              {loadError}
            </p>
          ) : accounts === null ? (
            <p className="flex items-center gap-2.5 p-6 text-[16px] text-ink-muted">
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
              Loading accounts…
            </p>
          ) : shown.length === 0 ? (
            <p className="p-6 text-[16px] text-ink-muted">{accounts.length === 0 ? 'No accounts yet.' : 'No account matches that search.'}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-[16px]">
                <thead className="border-b border-border text-[14px] text-ink-muted">
                  <tr>
                    <th scope="col" className="px-5 py-3 font-semibold">Name and email</th>
                    <th scope="col" className="px-3 py-3 font-semibold">Role</th>
                    <th scope="col" className="px-3 py-3 font-semibold">Clinic</th>
                    <th scope="col" className="px-5 py-3 font-semibold">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((a) => {
                    const RoleIcon = ROLE[a.role].icon
                    const clinic = clinicDraft[a.id] ?? a.practiceId
                    const clinicChanged = clinic !== a.practiceId
                    const saving = savingId === a.id
                    const isAdmin = a.role === 'admin'
                    return (
                      <tr key={a.id} className="border-b border-border last:border-0">
                        <th scope="row" className="px-5 py-3 font-normal">
                          <span className="block font-semibold text-ink">
                            {a.name}
                            {a.id === user?.id && <span className="font-normal text-ink-muted"> (you)</span>}
                          </span>
                          <span className="block text-[15px] text-ink-muted">{a.email}</span>
                        </th>
                        <td className="px-3 py-3">
                          <span className="inline-flex items-center gap-1.5 font-medium text-ink">
                            <RoleIcon className="h-4 w-4 text-ink-muted" aria-hidden />
                            {ROLE[a.role].label}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          {isAdmin ? (
                            <span className="text-ink-muted">All clinics</span>
                          ) : (
                            <select
                              aria-label={`Clinic for ${a.name}`}
                              value={clinic}
                              onChange={(e) => setClinicDraft((d) => ({ ...d, [a.id]: e.target.value }))}
                              disabled={saving}
                              className="h-11 max-w-[240px] rounded-xl border border-ink-faint bg-surface px-3 text-[15px] text-ink"
                            >
                              {PRACTICES.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name}
                                </option>
                              ))}
                            </select>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          {isAdmin ? (
                            <span className="text-[15px] text-ink-muted">Admins are changed in Supabase only.</span>
                          ) : (
                            <div className="flex flex-wrap items-center gap-2">
                              <Button
                                size="sm"
                                variant={a.role === 'patient' ? 'primary' : 'outline'}
                                className="min-h-[40px] text-[15px]"
                                disabled={saving}
                                onClick={() => setPending({ account: a, role: a.role === 'patient' ? 'physio' : 'patient', practiceId: clinic })}
                              >
                                {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                                {a.role === 'patient' ? 'Make physiotherapist' : 'Change back to patient'}
                              </Button>
                              {clinicChanged && (
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  className="min-h-[40px] text-[15px]"
                                  disabled={saving}
                                  onClick={() => setPending({ account: a, role: a.role as 'patient' | 'physio', practiceId: clinic })}
                                >
                                  Save clinic
                                </Button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <p className="mt-4 max-w-[70ch] text-[14px] text-ink-muted">
          Admin accounts are made in the Supabase SQL Editor, not here. See supabase/admin-role-migration.sql.
        </p>
          </>
        )}
      </main>

      <ConfirmDialog
        open={pending !== null}
        message={confirmText}
        cancelLabel="Cancel"
        confirmLabel={pending && pending.role === pending.account.role ? 'Move account' : pending?.role === 'physio' ? 'Make physiotherapist' : 'Change to patient'}
        onCancel={() => setPending(null)}
        onConfirm={() => pending && void apply(pending)}
      />
    </PageShell>
  )
}
