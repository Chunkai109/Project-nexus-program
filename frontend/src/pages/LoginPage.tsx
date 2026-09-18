import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, Lock, Mail } from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'
import { Logo } from '@/components/layout/Logo'
import { RoleToggle } from '@/components/ui/RoleToggle'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/lib/AuthContext'
import { PRACTICES } from '@/lib/mockData'
import type { UserRole } from '@/types'

export function LoginPage() {
  const [role, setRole] = useState<UserRole>('patient')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [practiceId, setPracticeId] = useState(PRACTICES[0].id)
  const { signIn } = useAuth()
  const navigate = useNavigate()

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    signIn({ role, email: email || (role === 'patient' ? 'alex.tan@patient.io' : 'physio@clinic.com'), practiceId })
    navigate(role === 'patient' ? '/patient/exercises' : '/physio')
  }

  return (
    <div className="noise-bg relative flex min-h-screen items-center justify-center overflow-hidden bg-base px-4">
      <div className="pointer-events-none absolute -left-32 top-0 h-96 w-96 rounded-full bg-electric/10 blur-[120px]" />
      <div className="pointer-events-none absolute -right-32 bottom-0 h-96 w-96 rounded-full bg-emerald/10 blur-[120px]" />

      <GlassCard className="relative z-10 w-full max-w-md p-10">
        <div className="flex flex-col items-center text-center">
          <Logo size="lg" />
          <p className="mt-3 text-sm text-ink-muted">Precision Wearable Rehabilitation</p>
        </div>

        <div className="mt-8">
          <RoleToggle value={role} onChange={setRole} />
        </div>

        <form className="mt-7 flex flex-col gap-4" onSubmit={handleSubmit}>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-muted">Email</span>
            <div className="flex items-center gap-2.5 rounded-xl border border-border bg-white/[0.03] px-3.5 py-3 transition-colors focus-within:border-electric">
              <Mail className="h-4 w-4 text-ink-faint" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={role === 'patient' ? 'alex.tan@patient.io' : 'you@clinic.com'}
                className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
              />
            </div>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-muted">Password</span>
            <div className="flex items-center gap-2.5 rounded-xl border border-border bg-white/[0.03] px-3.5 py-3 transition-colors focus-within:border-electric">
              <Lock className="h-4 w-4 text-ink-faint" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
              />
            </div>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-muted">Select Clinical Practice</span>
            <div className="relative flex items-center gap-2.5 rounded-xl border border-border bg-white/[0.03] px-3.5 py-3 transition-colors focus-within:border-electric">
              <select
                value={practiceId}
                onChange={(e) => setPracticeId(e.target.value)}
                className="w-full appearance-none bg-transparent text-sm text-ink outline-none"
              >
                {PRACTICES.map((p) => (
                  <option key={p.id} value={p.id} className="bg-surface text-ink">
                    {p.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none h-4 w-4 text-ink-faint" />
            </div>
          </label>

          <Button type="submit" size="lg" className="mt-2 w-full">
            Sign In to Dashboard
          </Button>
        </form>

        <div className="mt-6 flex items-center justify-between text-xs">
          <button className="text-ink-muted transition-colors hover:text-electric">Forgot Password?</button>
          <button className="font-medium text-electric transition-colors hover:text-electric-dim">
            Register New Account
          </button>
        </div>
      </GlassCard>
    </div>
  )
}
