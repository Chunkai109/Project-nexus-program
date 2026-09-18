export function RangeSlider({
  label,
  valueMin,
  valueMax,
  min,
  max,
  unit = '°',
  onChangeMin,
  onChangeMax,
}: {
  label: string
  valueMin: number
  valueMax: number
  min: number
  max: number
  unit?: string
  onChangeMin: (value: number) => void
  onChangeMax: (value: number) => void
}) {
  const pctMin = ((valueMin - min) / (max - min)) * 100
  const pctMax = ((valueMax - min) / (max - min)) * 100

  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="text-ink-muted">{label}</span>
        <span className="font-semibold text-ink">
          {valueMin}
          {unit} – {valueMax}
          {unit}
        </span>
      </div>
      <div className="relative flex h-5 items-center">
        <div
          className="absolute h-1 w-full rounded-full"
          style={{
            background: `linear-gradient(to right, var(--color-border-strong) ${pctMin}%, var(--color-accent) ${pctMin}%, var(--color-accent) ${pctMax}%, var(--color-border-strong) ${pctMax}%)`,
          }}
        />
        <input
          type="range"
          className="range-thumb absolute h-5 w-full"
          min={min}
          max={max}
          value={valueMin}
          onChange={(e) => onChangeMin(Math.min(Number(e.target.value), valueMax - 1))}
        />
        <input
          type="range"
          className="range-thumb absolute h-5 w-full"
          min={min}
          max={max}
          value={valueMax}
          onChange={(e) => onChangeMax(Math.max(Number(e.target.value), valueMin + 1))}
        />
      </div>
    </div>
  )
}
