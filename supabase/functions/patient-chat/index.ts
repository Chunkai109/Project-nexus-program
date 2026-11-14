/**
 * patient-chat: answers a physiotherapist's question about one patient.
 *
 * The physio portal sends a summary of the patient's sessions (numbers only,
 * no name or email) and the conversation so far. This function checks the
 * caller is a signed-in physio (or admin), asks Claude, and streams the
 * answer back as newline-delimited JSON:
 *   {"text":"..."}            a piece of the answer
 *   {"done":true,"stop":"…"}  the answer is complete ("refusal" = declined)
 *   {"error":"…"}             something went wrong part-way
 *
 * Needs the secret ANTHROPIC_API_KEY (supabase secrets set). The key never
 * reaches the browser. SUPABASE_URL and SUPABASE_ANON_KEY are provided by
 * Supabase automatically.
 */
import Anthropic from 'npm:@anthropic-ai/sdk@1.3.0'
import { createClient } from 'npm:@supabase/supabase-js@2.117.2'
import { SYSTEM_PROMPT } from './prompt.ts'

const MODEL = 'claude-opus-5-5'
const MAX_CONTEXT_CHARS = 80_000
const MAX_MESSAGES = 30
const MAX_MESSAGE_CHARS = 4_000

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

/** Returns an error message, or null when the body is a valid chat request. */
function checkBody(body: unknown): string | null {
  if (!body || typeof body !== 'object') return 'Request body must be JSON.'
  const { context, messages } = body as { context?: unknown; messages?: unknown }
  if (typeof context !== 'string' || context.trim() === '') return 'Missing patient data.'
  if (context.length > MAX_CONTEXT_CHARS) return 'Patient data is too long.'
  if (!Array.isArray(messages) || messages.length === 0) return 'Missing question.'
  if (messages.length > MAX_MESSAGES) return 'This chat is too long. Start a new chat.'
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i] as Partial<ChatTurn>
    const expected = i % 2 === 0 ? 'user' : 'assistant'
    if (m?.role !== expected || typeof m.content !== 'string' || m.content.trim() === '') return 'Messages must alternate question and answer.'
    if (m.content.length > MAX_MESSAGE_CHARS) return 'A message is too long.'
  }
  if (messages.length % 2 === 0) return 'The last message must be a question.'
  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'Use POST.' })

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json(500, { error: 'The chat is not set up yet: ANTHROPIC_API_KEY is missing on the server.' })

  // Only physios (and admins, whom my_role() reports as physio) may ask.
  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) return json(401, { error: 'Sign in first.' })
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  })
  const { data: role, error: roleError } = await supabase.rpc('my_role')
  if (roleError) return json(401, { error: 'Could not check your account. Sign in again.' })
  if (role !== 'physio') return json(403, { error: 'Only physiotherapists can use the patient chat.' })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'Request body must be JSON.' })
  }
  const problem = checkBody(body)
  if (problem) return json(400, { error: problem })
  const { context, messages } = body as { context: string; messages: ChatTurn[] }

  // The patient data rides in front of the first question, so it stays the
  // same on every turn of the chat and can be cached.
  const apiMessages: Anthropic.Beta.Messages.BetaMessageParam[] = messages.map((m, i) =>
    i === 0
      ? {
          role: 'user',
          content: [
            { type: 'text', text: `<patient_data>\n${context}\n</patient_data>` },
            { type: 'text', text: m.content },
          ],
        }
      : { role: m.role, content: m.content },
  )

  const client = new Anthropic({ apiKey })
  const encoder = new TextEncoder()
  const send = (controller: ReadableStreamDefaultController<Uint8Array>, obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'))

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const claude = client.beta.messages.stream(
          {
            model: MODEL,
            max_tokens: 8000,
            system: SYSTEM_PROMPT,
            messages: apiMessages,
            output_config: { effort: 'medium' },
            cache_control: { type: 'ephemeral' },
            // If Claude declines a question, Anthropic retries it on its default fallback model.
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
          },
          { signal: req.signal },
        )
        for await (const event of claude) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') send(controller, { text: event.delta.text })
        }
        const final = await claude.finalMessage()
        send(controller, { done: true, stop: final.stop_reason })
      } catch (err) {
        console.error('patient-chat failed', err instanceof Anthropic.APIError ? `${err.status} ${err.message}` : err)
        const message =
          err instanceof Anthropic.RateLimitError
            ? 'The AI is busy. Try again in a minute.'
            : err instanceof Anthropic.AuthenticationError
              ? 'The chat is not set up correctly: the server API key was rejected.'
              : err instanceof Anthropic.APIConnectionError
                ? 'Could not reach the AI service. Try again.'
                : 'The AI could not answer. Try again.'
        send(controller, { error: message })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, { headers: { ...CORS, 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' } })
})
