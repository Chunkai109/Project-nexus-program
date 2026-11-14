import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { AlertTriangle, FlaskConical, Lightbulb, MessageSquareText, RotateCcw, Send, Square } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { buildPatientContext } from '@/lib/patientChat/patientContext'
import { askPatientChat, PATIENT_CHAT_AVAILABLE, PatientChatError, type ChatEnd, type ChatTurn } from '@/lib/patientChat/askPatientChat'
import type { PatientPageData } from './PatientPageView'
import { SectionCard } from './ui/SectionCard'

const STARTERS = ['Is this patient improving?', 'What is their most common form fault?', 'What should I change in their plan?']
/** Questions + answers per chat; matches the server limit. */
const MAX_TURNS = 30
const MAX_QUESTION_CHARS = 2000

interface Message extends ChatTurn {
  /** Assistant messages only. */
  state?: 'streaming' | ChatEnd | 'error' | 'stopped'
}

/** One answer, with "Suggestion:" lines marked as suggestions for the physio to judge. */
function Answer({ text }: { text: string }) {
  const lines = text.split('\n')
  return (
    <div className="flex flex-col gap-1.5 text-[15px] leading-relaxed text-ink">
      {lines.map((line, i) => {
        const t = line.trim()
        if (!t) return null
        const suggestion = /^(?:-\s*)?suggestion:\s*/i.exec(t)
        if (suggestion)
          return (
            <p key={i} className="rounded-lg border-l-4 border-amber bg-amber/10 px-3 py-2">
              <span className="mb-0.5 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-amber-ink">
                <Lightbulb className="h-3.5 w-3.5" aria-hidden />
                Suggestion, for you to judge
              </span>
              {t.slice(suggestion[0].length)}
            </p>
          )
        if (t.startsWith('- '))
          return (
            <p key={i} className="flex gap-2 pl-1">
              <span aria-hidden className="text-ink-muted">•</span>
              <span>{t.slice(2)}</span>
            </p>
          )
        return <p key={i}>{t}</p>
      })}
    </div>
  )
}

const END_NOTE: Partial<Record<NonNullable<Message['state']>, string>> = {
  refusal: 'The AI declined to answer this question.',
  'cut-short': 'The answer was cut short. Ask a narrower question.',
  stopped: 'Stopped.',
}

/**
 * "Ask about this patient": a chat on the patient's page for the physio.
 * Sends a summary of the patient's sessions (no name or email) to the
 * patient-chat Edge Function, which asks Google Gemini. Nothing is saved: the chat
 * is gone when the physio leaves the page.
 */
export function PatientChatPanel({ data }: { data: PatientPageData }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const busy = messages.some((m) => m.state === 'streaming')
  const full = messages.length >= MAX_TURNS - 1

  // Rebuilt only when the patient's data changes, so a chat keeps the same summary.
  const [openedAt] = useState(() => Date.now())
  const context = useMemo(() => buildPatientContext({ history: data.history, isDemo: data.isDemo, plans: data.plans, now: openedAt }), [data.history, data.isDemo, data.plans, openedAt])

  useEffect(() => () => abortRef.current?.abort(), [])
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  async function ask(question: string) {
    const q = question.trim().slice(0, MAX_QUESTION_CHARS)
    if (!q || busy || full) return
    setError(null)
    setDraft('')
    // Only finished answers go back to the AI; a failed or stopped one is dropped with its question.
    const history: ChatTurn[] = []
    for (let i = 0; i + 1 < messages.length; i += 2) {
      const a = messages[i + 1]
      if (a.content.trim() && (a.state === 'complete' || a.state === 'cut-short')) history.push({ role: 'user', content: messages[i].content }, { role: 'assistant', content: a.content })
    }
    const turn: ChatTurn[] = [...history, { role: 'user', content: q }]
    setMessages((prev) => [...prev, { role: 'user', content: q }, { role: 'assistant', content: '', state: 'streaming' }])
    const controller = new AbortController()
    abortRef.current = controller
    const update = (fn: (m: Message) => Message) => setMessages((prev) => prev.map((m, i) => (i === prev.length - 1 ? fn(m) : m)))
    try {
      const end = await askPatientChat({ context, messages: turn, signal: controller.signal, onText: (piece) => update((m) => ({ ...m, content: m.content + piece })) })
      update((m) => ({ ...m, state: end }))
    } catch (err) {
      if (controller.signal.aborted) {
        update((m) => ({ ...m, state: 'stopped' }))
      } else {
        update((m) => ({ ...m, state: 'error' }))
        setError(err instanceof PatientChatError ? err.message : 'Something went wrong. Try again.')
      }
    } finally {
      abortRef.current = null
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    void ask(draft)
  }
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void ask(draft)
    }
  }
  function newChat() {
    abortRef.current?.abort()
    setMessages([])
    setError(null)
  }

  const subtitle = 'Ask about this patient’s recorded sessions. The AI sees their session numbers, not their name or email. Nothing here is saved.'

  if (!PATIENT_CHAT_AVAILABLE)
    return (
      <SectionCard title="Ask about this patient" subtitle={subtitle}>
        <p className="rounded-xl bg-surface-secondary px-4 py-3 text-[14px] text-ink-muted">Chat needs the online clinic account. It is not available in local mode.</p>
      </SectionCard>
    )

  return (
    <SectionCard
      title={
        <span className="inline-flex items-center gap-2">
          <MessageSquareText className="h-4 w-4 text-accent" aria-hidden />
          Ask about this patient
        </span>
      }
      subtitle={subtitle}
      actions={
        messages.length > 0 ? (
          <Button variant="ghost" size="sm" onClick={newChat}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            New chat
          </Button>
        ) : undefined
      }
    >
      {data.isDemo && (
        <p className="mb-4 flex items-start gap-2.5 rounded-xl bg-amber/10 px-4 py-3 text-[14px] font-medium text-amber-ink">
          <FlaskConical className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
          No real sessions yet, so answers are based on demo data, not this patient's results.
        </p>
      )}

      {messages.length > 0 && (
        <div ref={logRef} role="log" aria-live="polite" aria-label="Chat about this patient" className="mb-4 flex max-h-[480px] flex-col gap-4 overflow-y-auto pr-1">
          {messages.map((m, i) =>
            m.role === 'user' ? (
              <p key={i} className="max-w-[85%] self-end rounded-2xl rounded-br-md bg-accent/10 px-4 py-2.5 text-[15px] text-ink">
                {m.content}
              </p>
            ) : (
              <div key={i} className="max-w-[92%] self-start rounded-2xl rounded-bl-md border border-border bg-surface px-4 py-3">
                {m.content ? <Answer text={m.content} /> : m.state === 'streaming' ? <p className="text-[15px] text-ink-muted">Reading the sessions…</p> : null}
                {m.state && END_NOTE[m.state] && <p className="mt-2 text-[13px] font-medium text-ink-muted">{END_NOTE[m.state]}</p>}
                {m.state === 'error' && <p className="mt-2 text-[13px] font-medium text-crimson-ink">No answer.</p>}
                {m.content && m.state !== 'streaming' && <p className="mt-3 border-t border-border pt-2 text-[12px] text-ink-muted">Based on recorded session data only. Not a clinical assessment.</p>}
              </div>
            ),
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="mb-3 flex items-start gap-2 rounded-xl bg-crimson/10 px-4 py-2.5 text-[14px] font-medium text-crimson-ink">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
          {error}
        </p>
      )}

      {messages.length === 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {STARTERS.map((s) => (
            <Button key={s} variant="outline" size="sm" onClick={() => void ask(s)}>
              {s}
            </Button>
          ))}
        </div>
      )}

      {full ? (
        <p className="text-[14px] text-ink-muted">This chat is full. Start a new chat to keep asking.</p>
      ) : (
        <form onSubmit={onSubmit} className="flex items-end gap-2">
          <label htmlFor="patient-chat-input" className="sr-only">
            Your question about this patient
          </label>
          <textarea
            id="patient-chat-input"
            rows={2}
            value={draft}
            maxLength={MAX_QUESTION_CHARS}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="e.g. How has their drift changed over the last 5 sessions?"
            className="min-h-[48px] flex-1 resize-y rounded-xl border border-border-strong bg-surface px-3.5 py-2.5 text-[15px] text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
          />
          {busy ? (
            <Button type="button" variant="secondary" onClick={() => abortRef.current?.abort()} className="min-h-[48px]">
              <Square className="h-4 w-4" aria-hidden />
              Stop
            </Button>
          ) : (
            <Button type="submit" disabled={!draft.trim()} className="min-h-[48px]">
              <Send className="h-4 w-4" aria-hidden />
              Ask
            </Button>
          )}
        </form>
      )}
    </SectionCard>
  )
}
