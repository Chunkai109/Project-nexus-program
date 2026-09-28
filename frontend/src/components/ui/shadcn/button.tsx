import type { ButtonHTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/*
 * rounded-[0.5rem] instead of rounded-md: this preset's --radius is 0.625rem
 * (medium), and shadcn's own convention derives the button/input radius as
 * radius - 2px = 0.5rem. Tailwind's stock rounded-md (0.375rem) isn't wired
 * to --radius here on purpose — see index.css for why. Likewise sc-accent
 * (not accent): the app already owns --color-accent for its own token.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[0.5rem] text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90',
        destructive: 'bg-destructive text-white shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20',
        outline: 'border border-input bg-background shadow-xs hover:bg-sc-accent hover:text-sc-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80',
        ghost: 'hover:bg-sc-accent hover:text-sc-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-[0.5rem] px-3',
        lg: 'h-10 rounded-[0.5rem] px-6',
        icon: 'size-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />
}

export { buttonVariants }
