export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  onChange,
  tone = 'electric',
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  onChange: (value: number) => void
  tone?: 'electric' | 'amber'
}) {
  const pct = ((value - min) / (max - min)) * 100
  const fillColor = tone === 'amber' ? '#f59e0b' : '#38bdf8'

  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="text-ink-muted">{label}</span>
        <span className="font-semibold text-ink">
          {value}
          {unit}
        </span>
      </div>
      <div className="relative flex h-4 items-center">
        <div
          className="absolute h-1.5 w-full rounded-full bg-white/5"
          style={{ background: `linear-gradient(to right, ${fillColor} ${pct}%, rgba(255,255,255,0.06) ${pct}%)` }}
        />
        <input
          type="range"
          className="range-thumb relative h-4 w-full"
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
