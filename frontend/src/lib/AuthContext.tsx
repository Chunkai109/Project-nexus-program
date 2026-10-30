import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AuthUser, UserRole } from '@/types'
import { supabase } from '@/lib/supabase/client'

export function deriveNameFromEmail(email: string, role: UserRole): string {
  const name = email.split('@')[0].replace(/[._]/g, ' ')
  return name.length > 0 ? name.replace(/\b\w/g, (c) => c.toUpperCase()) : role === 'patient' ? 'Patient' : 'Physiotherapist'
}

type AuthResult = { user: AuthUser; error?: undefined } | { user?: undefined; error: string }

interface AuthContextValue {
  user: AuthUser | null
  /** True while a saved login is being restored at startup. Routes should wait instead of redirecting to /login. */
  initializing: boolean
  /** True when Supabase is configured: real accounts, passwords checked, role and practice come from the account. False in local demo mode. */
  realAccounts: boolean
  /** In local demo mode `role` and `practiceId` are taken as given; with real accounts they come from the account and are ignored. */
  signIn: (input: { role: UserRole; email: string; password: string; practiceId: string }) => Promise<AuthResult>
  /** Creates a patient account. Physio accounts are made by an admin (see supabase/schema.sql). */
  signUp: (input: { name: string; email: string; password: string; practiceId: string }) => Promise<AuthResult>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

interface ProfileRow {
  id: string
  role: UserRole
  name: string
  email: string
  practice_id: string
}

async function loadProfile(userId: string): Promise<AuthUser | null> {
  if (!supabase) return null
  const { data, error } = await supabase
    .from('profiles')
    .select('id, role, name, email, practice_id')
    .eq('id', userId)
    .single<ProfileRow>()
  if (error || !data) {
    console.error('Failed to load profile', error)
    return null
  }
  // Fire-and-forget: lets physios see when a patient last used the app.
  supabase
    .from('profiles')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', userId)
    .then(({ error: touchError }) => {
      if (touchError) console.error('Failed to update last seen', touchError)
    })
  return { id: data.id, role: data.role, name: data.name, email: data.email, practiceId: data.practice_id }
}

function friendlyAuthError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('invalid login credentials')) return 'Wrong email or password.'
  if (m.includes('email not confirmed')) return 'Please confirm your email first, then sign in.'
  if (m.includes('already registered')) return 'An account with this email already exists. Sign in instead.'
  if (m.includes('password should be')) return 'Password must be at least 6 characters.'
  if (m.includes('failed to fetch') || m.includes('network')) return "Can't reach the server. Check your internet connection."
  return message
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [initializing, setInitializing] = useState(Boolean(supabase))

  useEffect(() => {
    const client = supabase
    if (!client) return
    let cancelled = false

    client.auth.getSession().then(async ({ data }) => {
      const restored = data.session ? await loadProfile(data.session.user.id) : null
      if (!cancelled) {
        setUser(restored)
        setInitializing(false)
      }
    })

    const { data: listener } = client.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') setUser(null)
    })

    return () => {
      cancelled = true
      listener.subscription.unsubscribe()
    }
  }, [])

  const signIn = useCallback<AuthContextValue['signIn']>(async ({ role, email, password, practiceId }) => {
    if (!supabase) {
      const local: AuthUser = { id: `local:${email}`, role, email, practiceId, name: deriveNameFromEmail(email, role) }
      setUser(local)
      return { user: local }
    }
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error || !data.user) return { error: friendlyAuthError(error?.message ?? 'Sign in failed.') }
    const profile = await loadProfile(data.user.id)
    if (!profile) {
      await supabase.auth.signOut()
      return { error: "Your account has no profile yet. Ask your clinic admin to check it." }
    }
    setUser(profile)
    return { user: profile }
  }, [])

  const signUp = useCallback<AuthContextValue['signUp']>(async ({ name, email, password, practiceId }) => {
    if (!supabase) {
      const local: AuthUser = { id: `local:${email}`, role: 'patient', email, practiceId, name: name.trim() || deriveNameFromEmail(email, 'patient') }
      setUser(local)
      return { user: local }
    }
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name: name.trim(), practice_id: practiceId } },
    })
    if (error) return { error: friendlyAuthError(error.message) }
    if (!data.session || !data.user) {
      return { error: 'Account created. Check your email to confirm it, then sign in.' }
    }
    const profile = await loadProfile(data.user.id)
    if (!profile) return { error: 'Account created, but your profile could not be loaded. Try signing in.' }
    setUser(profile)
    return { user: profile }
  }, [])

  const signOut = useCallback(async () => {
    setUser(null)
    if (supabase) {
      const { error } = await supabase.auth.signOut()
      if (error) console.error('Sign out failed', error)
    }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ user, initializing, realAccounts: Boolean(supabase), signIn, signUp, signOut }),
    [user, initializing, signIn, signUp, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
