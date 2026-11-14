/**
 * patient-chat: answers a physiotherapist's question about one patient.
 *
 * The physio portal sends a summary of the patient's sessions (numbers only,
 * no name or email) and the conversation so far. This function checks the
 * caller is a signed-in physio (or admin), asks Google Gemini, and streams
 * the answer back as newline-delimited JSON:
 *   {"text":"..."}            a piece of the answer
 *   {"done":true,"stop":"…"}  complete ("refusal" = declined, "max_tokens" = cut short)
 *   {"error":"…"}             something went wrong part-way
 *
 * Needs the secret GEMINI_API_KEY (Google AI Studio; supabase secrets set).
 * The key never reaches the browser. Optional GEMINI_MODEL overrides the
 * model. SUPABASE_URL and SUPABASE_ANON_KEY are provided by Supabase.
 *
 * Free tier: Google's free-tier terms may let Google use what is sent to
 * improve its products, and it has rate limits. Check the current terms.
 */
import { ApiError, FinishReason, GoogleGenAI, type Content } from 'npm:@google/genai@2.32.0'
import { createClient } from 'npm:@supabase/supabase-js@2.117.2'
import { SYSTEM_PROMPT } from './prompt.ts'

const MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-3.8-flash'
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

  const apiKey = Deno.env.get('GEMINI_API_KEY')
  if (!apiKey) return json(500, { error: 'The chat is not set up yet: GEMINI_API_KEY is missing on the server.' })

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

  // The patient data rides in front of the first question, so every turn sees it.
  const contents: Content[] = messages.map((m, i) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: i === 0 ? [{ text: `<patient_data>\n${context}\n</patient_data>` }, { text: m.content }] : [{ text: m.content }],
  }))

  const baseUrl = Deno.env.get('GEMINI_BASE_URL') // tests only
  const ai = new GoogleGenAI({ apiKey, ...(baseUrl ? { httpOptions: { baseUrl } } : {}) })
  const encoder = new TextEncoder()
  const send = (controller: ReadableStreamDefaultController<Uint8Array>, obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'))
  const DECLINED: string[] = [FinishReason.SAFETY, FinishReason.PROHIBITED_CONTENT, FinishReason.BLOCKLIST, FinishReason.SPII, FinishReason.RECITATION]

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const answer = await ai.models.generateContentStream({
          model: MODEL,
          contents,
          config: { systemInstruction: SYSTEM_PROMPT, maxOutputTokens: 4096, abortSignal: req.signal },
        })
        let finish: string | undefined
        let blocked = false
        for await (const chunk of answer) {
          if (chunk.promptFeedback?.blockReason) blocked = true
          const text = chunk.text
          if (text) send(controller, { text })
          finish = chunk.candidates?.[0]?.finishReason ?? finish
        }
        const stop = blocked || (finish && DECLINED.includes(finish)) ? 'refusal' : finish === FinishReason.MAX_TOKENS ? 'max_tokens' : 'end_turn'
        send(controller, { done: true, stop })
      } catch (err) {
        console.error('patient-chat failed', err instanceof ApiError ? `${err.status} ${err.message}` : err)
        const status = err instanceof ApiError ? err.status : 0
        const message =
          status === 429
            ? 'The free AI limit is used up for now. Try again in a minute (or tomorrow if the daily limit is reached).'
            : status === 404
              ? `The AI model "${MODEL}" is not available. Set a current model with the GEMINI_MODEL secret.`
              : status === 400 || status === 401 || status === 403
              ? 'The chat is not set up correctly: the server API key or model was rejected.'
              : status === 0
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
