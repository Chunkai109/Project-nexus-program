import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/**
 * Null until VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY are set (see .env.example).
 * AppDataContext falls back to localStorage-only persistence when this is null,
 * so the app keeps working in local/demo mode until Supabase is configured.
 */
export const supabase: SupabaseClient | null = url && anonKey ? createClient(url, anonKey) : null
