import { useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Activity, AlertCircle, Check, ChevronDown, Info, Loader2, Stethoscope, UserRound } from 'lucide-react'
import { clsx } from 'clsx'
import { Button } from '@/components/ui/Button'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { ModelCredits } from '@/components/body/ModelCredits'
import { useAuth } from '@/lib/AuthContext'
import { useAppData } from '@/lib/data/AppDataContext'
import { PRACTICES } from '@/lib/mockData'
import type { AuthUser, UserRole } from '@/types'
// SmartPhysio rig photo: team to supply a final shot, ideally with the laptop screen visible.
// Today this is the team's own photo of the prototype being worn (no stock image, so no licence credit).
// It is imported so Vite bundles it into the app: nothing loads from the web.
import rigPhoto from '@/assets/login/smartphysio-rig-worn.webp'

type Mode = 'signin' | 'register'
type FieldName = 'name' | 'email' | 'password'

/** The navy of the light theme's text. Used over the photo in both themes, so it is written out here. */
const NAVY = '20 33 61'

function homeFor(user: AuthUser): string {
  return user.role === 'patient' ? '/patient/exercises' : '/physio'
}

/**
 * The sign-in code (lib/AuthContext) returns its own short messages. This puts
 * each one in plain words, says which field it belongs to, and marks the one
 * that is good news ("account created") so it is not shown as an error.
 */
function explain(message: string): { text: string; field?: FieldName; tone: 'error' | 'info' } {
  const m = message.toLowerCase()
  if (m.includes('wrong email or password')) return { text: "That email and password don't match. Try again.", tone: 'error' }
  if (m.includes("can't reach the server") || m.includes('failed to fetch') || m.includes('network'))
    return { text: "We couldn't reach the server. Check the connection and try again.", tone: 'error' }
  if (m.includes('confirm your email first')) return { text: 'Confirm your email first, then sign in.', field: 'email', tone: 'error' }
  if (m.includes('already exists')) return { text: 'An account with this email already exists. Sign in instead.', field: 'email', tone: 'error' }
  if (m.includes('at least 6')) return { text: 'Use a password with at least 6 characters.', field: 'password', tone: 'error' }
  if (m.startsWith('account created. check your email')) return { text: 'Account created. Check your email to confirm it, then sign in.', tone: 'info' }
  return { text: message, tone: 'error' }
}

const inputClass =
  'h-12 w-full rounded-xl border border-ink-faint bg-surface px-4 text-[16px] text-ink placeholder:text-ink-faint aria-[invalid=true]:border-crimson'

function Field({ label, error, children }: { label: string; error?: string; children: (ids: { id: string; errorId?: string }) => ReactNode }) {
  const id = useId()
  const errorId = error ? `${id}-error` : undefined
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[16px] font-semibold text-ink">
        {label}
      </label>
      {children({ id, errorId })}
      {error && (
        <p id={errorId} role="alert" className="mt-1 flex items-start gap-1.5 text-[16px] font-medium text-crimson-ink">
          <AlertCircle className="mt-[3px] h-4 w-4 flex-shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </div>
  )
}

function Hero() {
  return (
    <section aria-label="About SmartPhysio" className="relative h-[200px] overflow-hidden lg:h-auto lg:min-h-app lg:w-[55%]">
      <img
        src={rigPhoto}
        alt="A person wearing the SmartPhysio prototype: sensor pads and a strap on the right upper arm, the hub on a waist belt and a battery box at the hip."
        className="absolute inset-0 h-full w-full object-cover object-[50%_32%]"
      />
      {/* Navy overlay, stronger towards the bottom, so the white text stays readable over any part of the photo. */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{ background: `linear-gradient(to bottom, rgb(${NAVY} / 0.25) 0%, rgb(${NAVY} / 0.25) 34%, rgb(${NAVY} / 0.93) 60%, rgb(${NAVY} / 0.96) 100%)` }}
      />
      <div
        aria-hidden
        className="absolute inset-0 lg:hidden"
        style={{ background: `rgb(${NAVY} / 0.8)` }}
      />
      <div className="absolute inset-x-0 bottom-0 flex h-full flex-col justify-end px-6 pb-6 text-white transition-opacity duration-300 motion-reduce:transition-none lg:h-auto lg:px-12 lg:pb-12 starting:opacity-0">
        <p className="flex items-center gap-2.5 text-[20px] font-semibold tracking-tight">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent">
            <Activity size={18} strokeWidth={2.5} className="text-accent-ink" aria-hidden />
          </span>
          SmartPhysio
        </p>
        <h1 className="mt-4 max-w-[17em] text-[26px] font-bold leading-[1.15] tracking-tight lg:mt-6 lg:text-[clamp(32px,2.72vw,40px)]">
          Home arm rehab, checked rep by rep.
        </h1>
        <p className="mt-3 hidden max-w-[32em] text-[18px] leading-snug lg:block">Two motion sensors on one arm and a camera check each bicep curl.</p>
        <ul className="mt-6 hidden max-w-[36em] flex-col gap-2.5 text-[16px] leading-snug lg:flex">
          <li className="flex items-start gap-3">
            <UserRound className="mt-0.5 h-5 w-5 flex-shrink-0" aria-hidden />
            Patients: follow your exercise and see each rep checked.
          </li>
          <li className="flex items-start gap-3">
            <Stethoscope className="mt-0.5 h-5 w-5 flex-shrink-0" aria-hidden />
            Physiotherapists: see who needs you first, and tailor each plan.
          </li>
        </ul>
      </div>
    </section>
  )
}

const ROLES: { id: UserRole; label: string; icon: typeof UserRound }[] = [
  { id: 'patient', label: "I'm a patient", icon: UserRound },
  { id: 'physio', label: "I'm a physiotherapist", icon: Stethoscope },
]

export function LoginPage() {
  const [mode, setMode] = useState<Mode>('signin')
  const [role, setRole] = useState<UserRole>('patient')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [practiceId, setPracticeId] = useState(PRACTICES[0].id)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, string>>>({})
  const [notice, setNotice] = useState<{ text: string; tone: 'error' | 'info' } | null>(null)
  const [busy, setBusy] = useState(false)
  const { user, initializing, realAccounts, signIn, signUp } = useAuth()
  const { registerPatientVisit } = useAppData()
  const navigate = useNavigate()
  const inputs = useRef<Partial<Record<FieldName, HTMLInputElement | null>>>({})
  const tabs = useRef<Partial<Record<Mode, HTMLButtonElement | null>>>({})

  if (initializing) return null
  if (user) return <Navigate to={homeFor(user)} replace />

  const registering = mode === 'register'
  // Physio accounts are created by an admin, never from this screen.
  const physioRegisterBlocked = registering && role === 'physio'
  const showPractice = registering || !realAccounts

  function clearMessages() {
    setFieldErrors({})
    setNotice(null)
  }

  function switchMode(next: Mode) {
    setMode(next)
    clearMessages()
  }

  function onTabKey(e: KeyboardEvent) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const next: Mode = registering ? 'signin' : 'register'
    switchMode(next)
    tabs.current[next]?.focus()
  }

  /** Shows the errors and moves focus to the first field that has one. */
  function showFieldErrors(errors: Partial<Record<FieldName, string>>) {
    setFieldErrors(errors)
    const first = (['name', 'email', 'password'] as const).find((f) => errors[f])
    if (first) inputs.current[first]?.focus()
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (physioRegisterBlocked) return
    clearMessages()

    const errors: Partial<Record<FieldName, string>> = {}
    if (registering && !name.trim()) errors.name = 'Enter your name.'
    if (!email.trim()) errors.email = 'Enter your email.'
    else if (!/^\S+@\S+\.\S+$/.test(email.trim())) errors.email = 'Enter a full email address, like you@example.com.'
    if (!password) errors.password = 'Enter your password.'
    else if (registering && password.length < 6) errors.password = 'Use a password with at least 6 characters.'
    if (Object.keys(errors).length > 0) {
      showFieldErrors(errors)
      return
    }

    setBusy(true)
    const result = registering
      ? await signUp({ name, email, password, practiceId })
      : await signIn({ role, email, password, practiceId })
    setBusy(false)
    if (!result.user) {
      const problem = explain(result.error)
      if (problem.field) showFieldErrors({ [problem.field]: problem.text })
      else setNotice({ text: problem.text, tone: problem.tone })
      return
    }
    // Local demo mode has no accounts table, so patients are recorded here instead.
    if (!realAccounts && result.user.role === 'patient') {
      registerPatientVisit(result.user.name, result.user.email)
    }
    navigate(homeFor(result.user))
  }

  const tabClass = (active: boolean) =>
    clsx(
      '-mb-px min-h-[48px] flex-1 border-b-2 px-2 text-[17px] font-semibold transition-colors duration-200',
      active ? 'border-accent text-accent' : 'border-transparent text-ink-muted hover:text-ink',
    )

  return (
    <div className="flex min-h-app flex-col bg-surface lg:flex-row">
      <Hero />

      <main className="relative flex flex-1 items-center justify-center px-6 py-4 lg:px-10">
        <ThemeToggle className="absolute right-5 top-5 !h-12 !w-12" />

        <div className="w-full max-w-[420px]">
          <div role="tablist" aria-label="Sign in or create an account" className="flex border-b border-border-strong" onKeyDown={onTabKey}>
            <button
              type="button"
              role="tab"
              id="tab-signin"
              ref={(el) => { tabs.current.signin = el }}
              aria-selected={!registering}
              aria-controls="login-panel"
              tabIndex={registering ? -1 : 0}
              onClick={() => switchMode('signin')}
              className={tabClass(!registering)}
            >
              Sign in
            </button>
            <button
              type="button"
              role="tab"
              id="tab-register"
              ref={(el) => { tabs.current.register = el }}
              aria-selected={registering}
              aria-controls="login-panel"
              tabIndex={registering ? 0 : -1}
              onClick={() => switchMode('register')}
              className={tabClass(registering)}
            >
              Create account
            </button>
          </div>

          <div id="login-panel" role="tabpanel" aria-labelledby={registering ? 'tab-register' : 'tab-signin'}>
            <fieldset className="mt-4">
              <legend className="mb-1.5 text-[16px] font-semibold text-ink">Who is signing in?</legend>
              <div className="grid grid-cols-2 gap-3">
                {ROLES.map((r) => {
                  const selected = role === r.id
                  return (
                    <label
                      key={r.id}
                      className={clsx(
                        'relative flex min-h-[80px] cursor-pointer flex-col justify-between gap-1.5 rounded-xl border-2 p-3 transition-colors duration-200',
                        'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent',
                        selected ? 'border-accent bg-accent/10' : 'border-ink-faint bg-surface hover:bg-surface-secondary',
                      )}
                    >
                      {/* A real radio button: arrow keys move between the two cards. */}
                      <input
                        type="radio"
                        name="role"
                        value={r.id}
                        checked={selected}
                        onChange={() => {
                          setRole(r.id)
                          clearMessages()
                        }}
                        className="sr-only"
                      />
                      <span className="flex items-center justify-between gap-2">
                        <r.icon className={clsx('h-6 w-6', selected ? 'text-accent' : 'text-ink-muted')} aria-hidden />
                        {selected && (
                          <span className="inline-flex items-center gap-1 text-[14px] font-semibold text-accent" aria-hidden>
                            <Check className="h-4 w-4" />
                            Selected
                          </span>
                        )}
                      </span>
                      <span className="text-[16px] font-semibold leading-tight text-ink">{r.label}</span>
                    </label>
                  )
                })}
              </div>
            </fieldset>

            {physioRegisterBlocked ? (
              <p className="mt-5 flex items-start gap-3 rounded-xl bg-surface-secondary p-4 text-[16px] leading-relaxed text-ink">
                <Info className="mt-1 h-5 w-5 flex-shrink-0 text-ink-muted" aria-hidden />
                Physiotherapist accounts are set up by your clinic. Ask your clinic admin to create one for you, then sign in here.
              </p>
            ) : (
              <form className="mt-3 flex flex-col gap-2.5" onSubmit={handleSubmit} noValidate>
                {registering && (
                  <Field label="Your name" error={fieldErrors.name}>
                    {({ id, errorId }) => (
                      <input
                        id={id}
                        ref={(el) => { inputs.current.name = el }}
                        type="text"
                        autoComplete="name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Your name"
                        aria-invalid={!!fieldErrors.name}
                        aria-describedby={errorId}
                        className={inputClass}
                      />
                    )}
                  </Field>
                )}

                <Field label="Email" error={fieldErrors.email}>
                  {({ id, errorId }) => (
                    <input
                      id={id}
                      ref={(el) => { inputs.current.email = el }}
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder={role === 'patient' ? 'you@example.com' : 'you@clinic.com'}
                      aria-invalid={!!fieldErrors.email}
                      aria-describedby={errorId}
                      className={inputClass}
                    />
                  )}
                </Field>

                <Field label="Password" error={fieldErrors.password}>
                  {({ id, errorId }) => (
                    <input
                      id={id}
                      ref={(el) => { inputs.current.password = el }}
                      type="password"
                      autoComplete={registering ? 'new-password' : 'current-password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={registering ? 'At least 6 characters' : undefined}
                      aria-invalid={!!fieldErrors.password}
                      aria-describedby={errorId}
                      className={inputClass}
                    />
                  )}
                </Field>

                {showPractice && (
                  <Field label="Your clinic">
                    {({ id }) => (
                      <div className="relative">
                        <select id={id} value={practiceId} onChange={(e) => setPracticeId(e.target.value)} className={clsx(inputClass, 'appearance-none pr-11')}>
                          {PRACTICES.map((p) => (
                            <option key={p.id} value={p.id} className="bg-surface text-ink">
                              {p.name}
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-muted" aria-hidden />
                      </div>
                    )}
                  </Field>
                )}

                {notice && (
                  <p
                    role="alert"
                    className={clsx(
                      'flex items-start gap-2.5 rounded-xl px-4 py-3 text-[16px] font-medium',
                      notice.tone === 'error' ? 'bg-crimson/10 text-crimson-ink' : 'bg-surface-secondary text-ink',
                    )}
                  >
                    {notice.tone === 'error' ? (
                      <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0" aria-hidden />
                    ) : (
                      <Info className="mt-0.5 h-5 w-5 flex-shrink-0" aria-hidden />
                    )}
                    {notice.text}
                  </p>
                )}

                <Button type="submit" size="lg" className="mt-1 min-h-[52px] w-full text-[17px] font-semibold" disabled={busy}>
                  {busy && <Loader2 className="h-5 w-5 animate-spin" aria-hidden />}
                  {busy ? (registering ? 'Creating account…' : 'Signing in…') : registering ? 'Create account' : 'Sign in'}
                </Button>
              </form>
            )}

            {!registering && <p className="mt-3 text-[16px] text-ink-muted">Forgot your password? Ask your clinic admin.</p>}
            <ModelCredits className="mt-2" />
          </div>
        </div>
      </main>
    </div>
  )
}
