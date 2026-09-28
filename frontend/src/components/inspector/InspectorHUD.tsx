import { clsx } from 'clsx'
import { Info } from 'lucide-react'
import { useInspector } from './InspectorContext'

/**
 * Fixed bottom-right HUD, styled like a dev-tool status readout rather than
 * a mascot: monospace, uppercase label, a status dot instead of a face.
 * Idle it's just a compact pill; the instant the pointer enters an
 * <Inspectable>, it reflows in place to show that metric's title and a
 * short definition — no delay, no animation-in, so it reads as reactive
 * rather than "popping up".
 */
export function InspectorHUD() {
  const { active } = useInspector()

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-50 flex justify-end">
      <div
        className={clsx(
          'pointer-events-auto flex flex-col gap-1.5 rounded-lg border border-border-strong bg-surface/95 px-4 py-3 font-mono shadow-[var(--shadow-ambient-lg)] backdrop-blur-sm transition-[width] duration-150 ease-out',
          active ? 'w-[300px] max-w-[calc(100vw-2.5rem)] items-start' : 'w-auto items-center',
        )}
      >
        <div className="flex w-full items-center gap-2">
          <span
            className={clsx(
              'h-1.5 w-1.5 flex-shrink-0 rounded-full transition-colors duration-150',
              active ? 'animate-pulse bg-emerald' : 'bg-ink-faint/50',
            )}
          />
          <Info className="h-3.5 w-3.5 flex-shrink-0 text-ink-faint" />
          <span className="truncate text-[11px] font-semibold tracking-wider text-ink-muted uppercase">
            {active ? active.title : 'Inspector'}
          </span>
        </div>
        {active && <p className="text-[12px] leading-snug text-ink-faint">{active.description}</p>}
      </div>
    </div>
  )
}
