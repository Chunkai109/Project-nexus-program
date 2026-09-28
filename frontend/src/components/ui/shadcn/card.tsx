import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

// rounded-[0.625rem] rather than rounded-xl: this preset's base --radius
// (0.625rem, "medium") isn't wired into Tailwind's shared rounded-xl scale
// — see index.css for why — so it's applied directly here instead.
export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      className={cn('bg-card text-card-foreground flex flex-col gap-6 rounded-[0.625rem] border py-6 shadow-sm', className)}
      {...props}
    />
  )
}

export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        '@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-1.5 px-6 has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-6',
        className,
      )}
      {...props}
    />
  )
}

export function CardTitle({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-title" className={cn('leading-none font-semibold', className)} {...props} />
}

export function CardDescription({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-description" className={cn('text-muted-foreground text-sm', className)} {...props} />
}

export function CardAction({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-action"
      className={cn('col-start-2 row-span-2 row-start-1 self-start justify-self-end', className)}
      {...props}
    />
  )
}

export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn('px-6', className)} {...props} />
}

export function CardFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-footer" className={cn('flex items-center px-6 [.border-t]:pt-6', className)} {...props} />
}
