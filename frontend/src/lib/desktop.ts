/**
 * What the Electron desktop app exposes to the page (see desktop/preload.cjs).
 * Undefined when the app runs in a normal browser, so every caller must keep
 * working without it.
 */
export interface SmartPhysioDesktopBridge {
  /** Base URL of the AI form-check server the desktop app started, e.g. http://127.0.0.1:51234 */
  aiServerUrl: string
  appVersion: string
}

declare global {
  interface Window {
    smartphysioDesktop?: SmartPhysioDesktopBridge
  }
}

export function getDesktopBridge(): SmartPhysioDesktopBridge | undefined {
  return typeof window === 'undefined' ? undefined : window.smartphysioDesktop
}
