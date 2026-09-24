import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import type { AuthUser, UserRole } from '@/types'

export function deriveNameFromEmail(email: string, role: UserRole): string {
  const name = email.split('@')[0].replace(/[._]/g, ' ')
  return name.length > 0 ? name.replace(/\b\w/g, (c) => c.toUpperCase()) : role === 'patient' ? 'Patient' : 'Physiotherapist'
}

interface AuthContextValue {
  user: AuthUser | null
  signIn: (input: { role: UserRole; email: string; practiceId: string }) => void
  signOut: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      signIn: ({ role, email, practiceId }) => {
        setUser({ role, email, practiceId, name: deriveNameFromEmail(email, role) })
      },
      signOut: () => setUser(null),
    }),
    [user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
