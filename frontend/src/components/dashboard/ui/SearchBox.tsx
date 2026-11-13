import { Search } from 'lucide-react'

export function SearchBox({ value, onChange, label, className }: { value: string; onChange: (v: string) => void; label: string; className?: string }) {
  return (
    <label className={`relative block ${className ?? ''}`}>
      <span className="sr-only">{label}</span>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={label}
        className="h-11 w-full rounded-xl border border-ink-faint bg-surface pl-10 pr-3 text-[14px] text-ink placeholder:text-ink-muted"
      />
    </label>
  )
}
