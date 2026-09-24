import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, Lock, Mail } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Logo } from '@/components/layout/Logo'
import { RoleToggle } from '@/components/ui/RoleToggle'
import { Button } from '@/components/ui/Button'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { useAuth, deriveNameFromEmail } from '@/lib/AuthContext'
import { useAppData } from '@/lib/data/AppDataContext'
import { PRACTICES } from '@/lib/mockData'
import type { UserRole } from '@/types'

const fieldClass =
  'flex items-center gap-2.5 rounded-xl bg-surface-secondary px-4 py-3.5 ring-1 ring-transparent transition-all duration-200 focus-within:ring-accent/50'

export function LoginPage() {
  const [role, setRole] = useState<UserRole>('patient')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [practiceId, setPracticeId] = useState(PRACTICES[0].id)
  const { signIn } = useAuth()
  const { registerPatientVisit } = useAppData()
  const navigate = useNavigate()

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    signIn({ role, email, practiceId })
    if (role === 'patient') {
      registerPatientVisit(deriveNameFromEmail(email, role), email)
    }
    navigate(role === 'patient' ? '/patient/exercises' : '/physio')
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-canvas px-4 py-16">
      <ThemeToggle className="absolute right-6 top-6" />

      <Card className="w-full max-w-[440px] p-12" elevated>
        <div className="flex flex-col items-center text-center">
          <Logo size="lg" />
          <p className="mt-3 text-[15px] text-ink-muted">Precision Wearable Rehabilitation</p>
        </div>

        <div className="mt-10">
          <RoleToggle value={role} onChange={setRole} />
        </div>

        <form className="mt-8 flex flex-col gap-4" onSubmit={handleSubmit}>
          <label className="block">
            <span className="mb-2 block text-[13px] font-medium text-ink-muted">Email</span>
            <div className={fieldClass}>
              <Mail className="h-4 w-4 flex-shrink-0 text-ink-faint" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={role === 'patient' ? 'you@example.com' : 'you@clinic.com'}
                className="w-full bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-faint"
              />
            </div>
          </label>

          <label className="block">
            <span className="mb-2 block text-[13px] font-medium text-ink-muted">Password</span>
            <div className={fieldClass}>
              <Lock className="h-4 w-4 flex-shrink-0 text-ink-faint" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-faint"
              />
            </div>
          </label>

          <label className="block">
            <span className="mb-2 block text-[13px] font-medium text-ink-muted">Select Clinical Practice</span>
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
          </label>

          <Button type="submit" size="lg" className="mt-3 w-full">
            Sign In to Dashboard
          </Button>
        </form>

        <div className="mt-7 flex items-center justify-between text-[13px]">
          <button className="text-ink-muted transition-colors duration-200 hover:text-ink">Forgot Password?</button>
          <button className="font-medium text-accent transition-opacity duration-200 hover:opacity-80">
            Register New Account
          </button>
        </div>
      </Card>
    </div>
  )
}
