import { supabase } from '@/lib/supabase/client'
import type { UserRole } from '@/types'

/** One account as the Admin page shows it. No exercise or session data. */
export interface AdminAccount {
  id: string
  role: UserRole
  name: string
  email: string
  practiceId: string
  lastSeenAt: number | null
}

interface Row {
  id: string
  role: UserRole
  name: string
  email: string
  practice_id: string
  last_seen_at: string | null
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string }

const NO_SERVER = 'The Admin page needs real accounts. This copy of the app is in local demo mode.'

/** Every account, all clinics. The database only returns them to an admin (see supabase/admin-role-migration.sql). */
export async function listAccounts(): Promise<Result<AdminAccount[]>> {
  if (!supabase) return { ok: false, error: NO_SERVER }
  const { data, error } = await supabase.from('profiles').select('id, role, name, email, practice_id, last_seen_at').order('name')
  if (error) return { ok: false, error: "We couldn't load the accounts. Check the connection and try again." }
  return {
    ok: true,
    value: (data as Row[]).map((r) => ({
      id: r.id,
      role: r.role,
      name: r.name,
      email: r.email,
      practiceId: r.practice_id,
      lastSeenAt: r.last_seen_at ? Date.parse(r.last_seen_at) : null,
    })),
  }
}

/** Sets an account to patient or physiotherapist, in the given clinic. The database refuses anyone who is not an admin. */
export async function setAccount(id: string, role: 'patient' | 'physio', practiceId: string): Promise<Result<null>> {
  if (!supabase) return { ok: false, error: NO_SERVER }
  const { error } = await supabase.rpc('admin_set_account', { target: id, new_role: role, new_practice: practiceId })
  if (error) return { ok: false, error: "We couldn't save that change. Nothing was changed. Try again." }
  return { ok: true, value: null }
}
