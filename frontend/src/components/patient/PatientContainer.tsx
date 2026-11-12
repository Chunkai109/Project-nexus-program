import type { ReactNode } from 'react'
import { clsx } from 'clsx'

/**
 * The one width and side padding shared by the patient top bar's content and
 * every patient page's content, so their left and right edges always line up.
 * `wide` is for the Live session, which uses the whole window.
 */
export function PatientContainer({ children, className, wide = false }: { children: ReactNode; className?: string; wide?: boolean }) {
  return <div className={clsx('mx-auto w-full px-4 sm:px-6 lg:px-10', !wide && 'max-w-7xl', className)}>{children}</div>
}
