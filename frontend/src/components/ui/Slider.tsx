export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  onChange,
  tone = 'accent',
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  onChange: (value: number) => void
  tone?: 'accent' | 'amber'
}) {
  const pct = ((value - min) / (max - min)) * 100
  const fillColor = tone === 'amber' ? 'var(--color-amber)' : 'var(--color-accent)'

  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="text-ink-muted">{label}</span>
        <span className="font-semibold text-ink">
          {value}
          {unit}
        </span>
      </div>
      <div className="relative flex h-5 items-center">
        <div
          className="absolute h-1 w-full rounded-full"
          style={{
            background: `linear-gradient(to right, ${fillColor} ${pct}%, var(--color-border-strong) ${pct}%)`,
          }}
        />
        <input
          type="range"
          className="range-thumb relative h-5 w-full"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </div>
    </div>
  )
}
