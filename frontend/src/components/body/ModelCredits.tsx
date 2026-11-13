import { clsx } from 'clsx'

/** Required credit for the muscle shapes (CC BY-SA). Keep it visible somewhere in the app. */
export function ModelCredits({ className }: { className?: string }) {
  return (
    <p className={clsx('text-[12px] leading-relaxed text-ink-faint', className)}>
      Muscle models:{' '}
      <a className="underline" href="https://github.com/Z-Anatomy/Models-of-human-anatomy" target="_blank" rel="noreferrer">
        Z-Anatomy
      </a>
      , CC BY-SA 4.0 (based on BodyParts3D, CC BY-SA 2.1 JP).
    </p>
  )
}
