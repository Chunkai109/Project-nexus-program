import { createContext, useContext } from 'react'
import type { AuthUser, UserRole } from '@/types'

/** True on a development build (`npm run dev`); false in the desktop installer. See DevPreview.tsx. */
export const DEV_PREVIEW_AVAILABLE = import.meta.env.DEV

export type PreviewRole = Extract<UserRole, 'patient' | 'physio'>
export const STORAGE_KEY = 'smartphysio:dev-preview'

export const PREVIEW_PATIENT = { name: 'Preview patient', email: 'preview-patient@example.com' }

export function previewUser(role: PreviewRole, practiceId: string): AuthUser {
  return role === 'patient'
    ? { id: 'preview-patient', role, practiceId, ...PREVIEW_PATIENT }
    : { id: 'preview-physio', role, practiceId, name: 'Preview physio', email: 'preview-physio@example.com' }
}

export function readStored(): PreviewRole | null {
  try {
    const v = window.sessionStorage.getItem(STORAGE_KEY)
    return v === 'patient' || v === 'physio' ? v : null
  } catch {
    return null
  }
}

export interface DevPreviewValue {
  role: PreviewRole | null
  start: (role: PreviewRole) => void
  end: () => void
}

export const DevPreviewContext = createContext<DevPreviewValue>({ role: null, start: () => {}, end: () => {} })

export function useDevPreview(): DevPreviewValue {
  return useContext(DevPreviewContext)
}

