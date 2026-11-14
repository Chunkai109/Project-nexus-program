import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Eye, Stethoscope, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { DEV_PREVIEW_AVAILABLE, useDevPreview, type PreviewRole } from '@/components/layout/devPreviewState'

const OPTIONS: { role: PreviewRole; label: string; hint: string; icon: typeof UserRound }[] = [
  { role: 'patient', label: 'Patient app', hint: 'As a test patient with one Bicep Curl plan', icon: UserRound },
  { role: 'physio', label: 'Physio portal', hint: 'As a test physiotherapist', icon: Stethoscope },
]

/**
 * "Preview the app": opens the app as a test patient or physio, with no
 * login. Development builds only; the button is not rendered in a release
 * build. See components/layout/DevPreview.tsx.
 */
export function PreviewAppButton() {
  const { start } = useDevPreview()
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    const onClick = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onClick)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onClick)
    }
  }, [open])

  if (!DEV_PREVIEW_AVAILABLE) return null
  return (
    <div ref={wrap} className="relative">
      <Button size="sm" className="min-h-[40px] text-[15px]" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((o) => !o)}>
        <Eye className="h-4 w-4" aria-hidden />
        Preview the app
        <ChevronDown className="h-4 w-4" aria-hidden />
      </Button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-80 rounded-xl border border-border-strong bg-surface p-2 shadow-[var(--shadow-ambient-lg)]">
          <p className="px-2 pb-2 pt-1 text-[13px] text-ink-muted">Development build only. Opens with sandbox data in this browser; nothing real is read or changed.</p>
          {OPTIONS.map((o) => (
            <button
              key={o.role}
              type="button"
              onClick={() => {
                setOpen(false)
                start(o.role)
              }}
              className="flex w-full items-start gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-surface-secondary"
            >
              <o.icon className="mt-0.5 h-5 w-5 flex-shrink-0 text-ink-muted" aria-hidden />
              <span>
                <span className="block text-[15px] font-semibold text-ink">{o.label}</span>
                <span className="block text-[13px] text-ink-muted">{o.hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
