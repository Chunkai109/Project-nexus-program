import { clsx } from 'clsx'
import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

const variantClass: Record<Variant, string> = {
  primary:
    'bg-electric text-slate-950 hover:bg-electric-dim shadow-[0_0_20px_-4px_rgba(56,189,248,0.6)] font-semibold',
  secondary: 'bg-surface hover:bg-surface-hover text-ink border border-border',
  danger: 'bg-crimson hover:bg-red-600 text-white font-semibold shadow-[0_0_20px_-4px_rgba(239,68,68,0.6)]',
  ghost: 'bg-transparent hover:bg-white/5 text-ink-muted hover:text-ink',
  outline: 'bg-transparent border border-border-strong hover:border-electric text-ink hover:text-electric',
}

const sizeClass: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-sm rounded-lg gap-1.5',
  md: 'px-4 py-2.5 text-sm rounded-xl gap-2',
  lg: 'px-6 py-3.5 text-base rounded-xl gap-2.5',
}

export function Button({ variant = 'primary', size = 'md', className, ...rest }: ButtonProps) {
  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center whitespace-nowrap transition-all duration-150 active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none cursor-pointer',
        variantClass[variant],
        sizeClass[size],
        className,
      )}
      {...rest}
    />
  )
}
