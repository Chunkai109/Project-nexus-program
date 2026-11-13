import { ArrowLeft } from 'lucide-react'

/** A text link back to the page this one was opened from. */
export function BackLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg text-[14px] font-semibold text-accent hover:underline">
      <ArrowLeft className="h-4 w-4" aria-hidden />
      {label}
    </button>
  )
}
