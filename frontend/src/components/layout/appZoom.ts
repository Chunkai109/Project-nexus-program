/**
 * The whole app is zoomed so every screen keeps the proportions of a
 * 1440 x 900 reference screen on any desktop display. These are the rules,
 * with no DOM access, so they can be checked on their own.
 */

export const REFERENCE_WIDTH = 1440
export const REFERENCE_HEIGHT = 900
/** Below this window width (phones, tablets) there is no automatic zoom. */
export const NO_AUTO_ZOOM_BELOW = 1024

export interface ZoomLimits {
  min: number
  max: number
}

export const USER_MULTIPLIER_MIN = 0.8
export const USER_MULTIPLIER_MAX = 1.5
export const USER_MULTIPLIER_STEP = 0.1
const FINAL_MIN = 0.75
const FINAL_MAX = 2

/** `/patient/session/:id` (not `/patient/session-summary/...`) and the demo's live screen. */
export function isLiveRoute(pathname: string): boolean {
  return /^\/patient\/session\/[^/]+\/?$/.test(pathname) || /^\/demo\/patient\/live\/?$/.test(pathname)
}

/** How far the automatic factor may go on this screen. */
export function zoomLimitsFor(pathname: string, windowWidth: number): ZoomLimits {
  if (windowWidth < NO_AUTO_ZOOM_BELOW) return { min: 1, max: 1 }
  // Live must always fit on screen without scrolling, so it may shrink.
  if (isLiveRoute(pathname)) return { min: 0.75, max: 1.5 }
  // Physios can take slightly smaller text; more fits on a laptop.
  if (pathname.startsWith('/physio')) return { min: 0.85, max: 1.5 }
  // Patient pages and login: text never shrinks below its designed size.
  return { min: 1, max: 1.5 }
}

/** The smaller of the two ratios, so content fits the shorter dimension (16:9, 16:10, ultrawide). */
export function autoFactor(windowWidth: number, windowHeight: number): number {
  return Math.min(windowWidth / REFERENCE_WIDTH, windowHeight / REFERENCE_HEIGHT)
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function clampUserMultiplier(m: number): number {
  return Math.round(clamp(m, USER_MULTIPLIER_MIN, USER_MULTIPLIER_MAX) * 10) / 10
}

/** Clamped automatic factor x the user's own size choice, to 3 decimals. */
export function finalZoom(auto: number, limits: ZoomLimits, userMultiplier: number): number {
  const z = clamp(clamp(auto, limits.min, limits.max) * userMultiplier, FINAL_MIN, FINAL_MAX)
  return Math.round(z * 1000) / 1000
}

/** The zoom for a window of this size (in zoom-independent pixels) on this screen. */
export function zoomFor(pathname: string, windowWidth: number, windowHeight: number, userMultiplier = 1): number {
  return finalZoom(autoFactor(windowWidth, windowHeight), zoomLimitsFor(pathname, windowWidth), userMultiplier)
}
