import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { clampUserMultiplier, USER_MULTIPLIER_STEP, zoomFor } from './appZoom'

const STORAGE_KEY = 'smartphysio:zoom-multiplier'
const RESIZE_DEBOUNCE_MS = 100

/** The desktop app's zoom controls (see desktop/preload.cjs). Absent in a normal browser. */
interface DesktopZoomBridge {
  setZoom?: (factor: number) => void
  getZoom?: () => number
}
function desktopZoom(): DesktopZoomBridge | null {
  const bridge = (window as unknown as { smartphysioDesktop?: DesktopZoomBridge }).smartphysioDesktop
  return bridge && typeof bridge.setZoom === 'function' ? bridge : null
}

function readMultiplier(): number {
  try {
    const stored = Number(window.localStorage.getItem(STORAGE_KEY))
    return stored > 0 ? clampUserMultiplier(stored) : 1
  } catch {
    return 1
  }
}

/**
 * Scales the whole app to the window (rules in appZoom.ts). Mount once.
 *
 * One mechanism per environment, never both:
 * - Desktop app: real page zoom through the preload bridge.
 * - Browser: CSS `zoom` on <html>, with `--app-zoom` set to the same value so
 *   full-height rules can divide by it (see `.min-h-app` in index.css).
 *
 * Ctrl/Cmd with + / - / 0 changes the user's own size multiplier, which is
 * remembered. The keys are handled here so the automatic zoom never undoes
 * the user's choice.
 */
export function useAppZoom() {
  const { pathname } = useLocation()
  const [multiplier, setMultiplier] = useState(readMultiplier)
  // The page zoom this hook last set in the desktop app, needed to measure the window (see below).
  const appliedRef = useRef<number | null>(null)

  const apply = useCallback(() => {
    const desktop = desktopZoom()
    // The window must be measured in pixels the zoom itself does not change,
    // or the factor would feed back into itself:
    // - CSS zoom on <html> leaves innerWidth/innerHeight alone, so the browser uses them as they are.
    // - Page zoom shrinks them, so the desktop app multiplies by the factor in force.
    let scale = 1
    if (desktop) {
      if (appliedRef.current === null) appliedRef.current = desktop.getZoom?.() ?? 1
      scale = appliedRef.current
    }
    const zoom = zoomFor(pathname, Math.round(window.innerWidth * scale), Math.round(window.innerHeight * scale), multiplier)
    if (desktop) {
      if (zoom !== appliedRef.current) desktop.setZoom?.(zoom)
      appliedRef.current = zoom
      return
    }
    const root = document.documentElement
    root.style.setProperty('--app-zoom', String(zoom))
    root.style.zoom = zoom === 1 ? '' : String(zoom)
  }, [pathname, multiplier])

  // On load, on route change (limits differ by screen) and on resize.
  useEffect(() => {
    apply()
    let timer: ReturnType<typeof setTimeout> | undefined
    function onResize() {
      clearTimeout(timer)
      timer = setTimeout(apply, RESIZE_DEBOUNCE_MS)
    }
    window.addEventListener('resize', onResize)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('resize', onResize)
    }
  }, [apply])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const bigger = e.key === '=' || e.key === '+' || e.code === 'NumpadAdd'
      const smaller = e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract'
      const reset = e.key === '0' || e.code === 'Numpad0'
      if (!bigger && !smaller && !reset) return
      e.preventDefault()
      setMultiplier((m) => {
        const next = reset ? 1 : clampUserMultiplier(m + (bigger ? USER_MULTIPLIER_STEP : -USER_MULTIPLIER_STEP))
        try {
          window.localStorage.setItem(STORAGE_KEY, String(next))
        } catch {
          // Storage blocked: the size still changes, it just isn't remembered.
        }
        return next
      })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
