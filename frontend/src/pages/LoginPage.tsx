import { useState, type FormEvent, type ReactNode } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { ChevronDown, Lock, Mail, User } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Logo } from '@/components/layout/Logo'
import { RoleToggle } from '@/components/ui/RoleToggle'
import { Button } from '@/components/ui/Button'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { useAuth } from '@/lib/AuthContext'
import { useAppData } from '@/lib/data/AppDataContext'
import { PRACTICES } from '@/lib/mockData'
import type { AuthUser, UserRole } from '@/types'

const fieldClass =
  'flex items-center gap-2.5 rounded-xl bg-surface-secondary px-4 py-3.5 ring-1 ring-transparent transition-all duration-200 focus-within:ring-accent/50'

const inputClass = 'w-full bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-faint'

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-[13px] font-medium text-ink-muted">{label}</span>
      {children}
    </label>
  )
}

function homeFor(user: AuthUser): string {
  return user.role === 'patient' ? '/patient/exercises' : '/physio'
}

export function LoginPage() {
  const [mode, setMode] = useState<'signin' | 'register'>('signin')
  const [role, setRole] = useState<UserRole>('patient')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [practiceId, setPracticeId] = useState(PRACTICES[0].id)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { user, initializing, realAccounts, signIn, signUp } = useAuth()
  const { registerPatientVisit } = useAppData()
  const navigate = useNavigate()

  if (initializing) return null
  if (user) return <Navigate to={homeFor(user)} replace />

  const registering = mode === 'register'
  // Physio accounts are created by an admin, never from this screen.
  const physioRegisterBlocked = registering && role === 'physio'
  const showPractice = registering || !realAccounts

  function switchMode(next: 'signin' | 'register') {
    setMode(next)
    setError(null)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (physioRegisterBlocked) return
    setError(null)
    setBusy(true)
    const result = registering
      ? await signUp({ name, email, password, practiceId })
      : await signIn({ role, email, password, practiceId })
    setBusy(false)
    if (!result.user) {
      setError(result.error)
      return
    }
    // Local demo mode has no accounts table, so patients are recorded here instead.
    if (!realAccounts && result.user.role === 'patient') {
      registerPatientVisit(result.user.name, result.user.email)
    }
    navigate(homeFor(result.user))
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-canvas px-4 py-16">
      <ThemeToggle className="absolute right-6 top-6" />

      <Card className="w-full max-w-[440px] p-12" elevated>
        <div className="flex flex-col items-center text-center">
          <Logo size="lg" />
          <p className="mt-3 text-[15px] text-ink-muted">
            {registering ? 'Create your patient account' : 'Precision Wearable Rehabilitation'}
          </p>
        </div>

        <div className="mt-10">
          <RoleToggle
            value={role}
            onChange={(next) => {
              setRole(next)
              setError(null)
            }}
          />
        </div>

        {physioRegisterBlocked ? (
          <div className="mt-8 rounded-xl bg-surface-secondary p-5 text-[14px] leading-relaxed text-ink-muted">
            Physiotherapist accounts are set up by your clinic. Ask your clinic admin to create one for you, then sign
            in here.
          </div>
        ) : (
          <form className="mt-8 flex flex-col gap-4" onSubmit={handleSubmit}>
            {registering && (
              <Field label="Full name">
                <div className={fieldClass}>
                  <User className="h-4 w-4 flex-shrink-0 text-ink-faint" />
                  <input
                    type="text"
                    required
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                    className={inputClass}
                  />
                </div>
              </Field>
            )}

            <Field label="Email">
              <div className={fieldClass}>
                <Mail className="h-4 w-4 flex-shrink-0 text-ink-faint" />
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={role === 'patient' ? 'you@example.com' : 'you@clinic.com'}
                  className={inputClass}
                />
              </div>
            </Field>

            <Field label="Password">
              <div className={fieldClass}>
                <Lock className="h-4 w-4 flex-shrink-0 text-ink-faint" />
                <input
                  type="password"
                  required
                  minLength={registering ? 6 : undefined}
                  autoComplete={registering ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={registering ? 'At least 6 characters' : '••••••••'}
                  className={inputClass}
                />
              </div>
            </Field>

            {showPractice && (
              <Field label="Select Clinical Practice">
                <div className={`relative ${fieldClass}`}>
                  <select
                    value={practiceId}
                    onChange={(e) => setPracticeId(e.target.value)}
                    className="w-full appearance-none bg-transparent text-[15px] text-ink outline-none"
                  >
                    {PRACTICES.map((p) => (
                      <option key={p.id} value={p.id} className="bg-surface text-ink">
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none h-4 w-4 flex-shrink-0 text-ink-faint" />
                </div>
              </Field>
            )}

            {error && (
              <p role="alert" className="rounded-xl bg-crimson/10 px-4 py-3 text-[13px] text-crimson">
                {error}
              </p>
            )}

            <Button type="submit" size="lg" className="mt-3 w-full" disabled={busy}>
              {busy ? 'Please wait…' : registering ? 'Create Account' : 'Sign In to Dashboard'}
            </Button>
          </form>
        )}

        <div className="mt-7 flex items-center justify-between gap-4 text-[13px]">
          {realAccounts && !registering ? (
            <span className="text-ink-faint">Forgot your password? Ask your clinic admin.</span>
          ) : (
            <span />
          )}
          {registering ? (
            <button
              type="button"
              onClick={() => switchMode('signin')}
              className="font-medium text-accent transition-opacity duration-200 hover:opacity-80"
            >
              Back to Sign In
            </button>
          ) : (
            <button
              type="button"
              onClick={() => switchMode('register')}
              className="font-medium text-accent transition-opacity duration-200 hover:opacity-80"
            >
              Register New Account
            </button>
          )}
        </div>
      </Card>
    </div>
  )
}
