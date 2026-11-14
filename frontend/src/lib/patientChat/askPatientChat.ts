import { supabase } from '@/lib/supabase/client'

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

/** How an answer ended. "refusal" = the AI declined this question. */
export type ChatEnd = 'complete' | 'refusal' | 'cut-short'

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL ?? ''}/functions/v1/patient-chat`
const ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? ''

/** The chat runs through the clinic's Supabase project; local mode has none. */
export const PATIENT_CHAT_AVAILABLE = supabase !== null

export class PatientChatError extends Error {}

/**
 * Sends the conversation to the patient-chat Edge Function and calls
 * `onText` with each piece of the answer as it arrives.
 */
export async function askPatientChat({
  context,
  messages,
  onText,
  signal,
}: {
  context: string
  messages: ChatTurn[]
  onText: (piece: string) => void
  signal?: AbortSignal
}): Promise<ChatEnd> {
  if (!supabase) throw new PatientChatError('Chat needs the online clinic account.')
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new PatientChatError('Your sign-in has expired. Sign in again.')

  let res: Response
  try {
    res = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: ANON_KEY },
      body: JSON.stringify({ context, messages }),
      signal,
    })
  } catch (err) {
    if (signal?.aborted) throw err
    throw new PatientChatError('Could not reach the server. Check the internet connection.')
  }
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => null)) as { error?: string; message?: string } | null
    if (res.status === 404) throw new PatientChatError('The chat is not set up on the server yet (patient-chat function not deployed).')
    throw new PatientChatError(body?.error ?? body?.message ?? `The server answered ${res.status}.`)
  }

  // Newline-delimited JSON: {"text"}, then {"done","stop"} or {"error"}.
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (value) buffer += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!line) continue
      const msg = JSON.parse(line) as { text?: string; done?: boolean; stop?: string | null; error?: string }
      if (msg.error) throw new PatientChatError(msg.error)
      if (typeof msg.text === 'string') onText(msg.text)
      if (msg.done) return msg.stop === 'refusal' ? 'refusal' : msg.stop === 'max_tokens' ? 'cut-short' : 'complete'
    }
    if (done) throw new PatientChatError('The answer stopped part-way. Try again.')
  }
}
