import { clsx } from 'clsx'
import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

const variantClass: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:opacity-90 font-medium',
  secondary: 'bg-surface-secondary hover:bg-surface-hover text-ink font-medium',
  danger: 'bg-crimson text-white hover:opacity-90 font-medium',
  ghost: 'bg-transparent hover:bg-surface-secondary text-ink-muted hover:text-ink',
  outline: 'bg-transparent border border-border-strong hover:border-ink-faint text-ink',
}

const sizeClass: Record<Size, string> = {
  sm: 'px-3.5 py-1.5 text-[13px] rounded-full gap-1.5',
  md: 'px-5 py-2.5 text-sm rounded-full gap-2',
  lg: 'px-7 py-3.5 text-[15px] rounded-full gap-2.5',
}

export function Button({ variant = 'primary', size = 'md', className, ...rest }: ButtonProps) {
  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center whitespace-nowrap transition-all duration-200 ease-out active:scale-[0.99] disabled:opacity-40 disabled:pointer-events-none cursor-pointer',
        variantClass[variant],
        sizeClass[size],
        className,
      )}
      {...rest}
    />
  )
}
