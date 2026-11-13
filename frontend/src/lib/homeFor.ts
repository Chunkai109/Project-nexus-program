import type { UserRole } from '@/types'

/** The first page each kind of account lands on after signing in. */
export function homeFor(role: UserRole): string {
  return role === 'patient' ? '/patient/exercises' : role === 'admin' ? '/admin' : '/physio'
}
