import { clsx } from 'clsx'
import type { HTMLAttributes } from 'react'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  elevated?: boolean
}

export function Card({ className, elevated = false, children, ...rest }: CardProps) {
  return (
    <div
      className={clsx(
        'surface-panel rounded-2xl',
        elevated && 'shadow-[var(--shadow-ambient-lg)]',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  )
}
