import { useState } from 'react'
import { Bold, Italic, List, Save } from 'lucide-react'
import { clsx } from 'clsx'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Slider } from '@/components/ui/Slider'
import { RangeSlider } from '@/components/ui/RangeSlider'

const MUSCLE_TAGS = ['Quadriceps', 'Hamstrings', 'Glutes', 'Calves', 'Stabilizers', 'Ankle Complex', 'Core']

const fieldClass =
  'w-full rounded-xl bg-surface-secondary px-4 py-3 text-[14px] text-ink outline-none ring-1 ring-transparent transition-all duration-200 focus:ring-accent/50'

export function ProtocolBuilder() {
  const [title, setTitle] = useState('Bilateral Squat Rehab')
  const [tags, setTags] = useState<string[]>(['Quadriceps', 'Glutes'])
  const [sets, setSets] = useState(3)
  const [reps, setReps] = useState(12)
  const [romMin, setRomMin] = useState(90)
  const [romMax, setRomMax] = useState(110)
  const [faultThreshold, setFaultThreshold] = useState(8)
  const [targetEmg, setTargetEmg] = useState(65)
  const [instructions, setInstructions] = useState(
    'Attach Pods 1–2 to vastus medialis, Pods 3–4 to lateral knee joint line. Confirm all pods read green before beginning.',
  )
  const [saved, setSaved] = useState(false)

  function toggleTag(tag: string) {
    setTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]))
  }

  function handleSave() {
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <Card className="p-7">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">Protocol Builder</h2>
          <p className="text-[13px] text-ink-faint">Define biomechanical thresholds prescribed for this exercise</p>
        </div>
        <Button size="sm" onClick={handleSave}>
          <Save className="h-3.5 w-3.5" />
          {saved ? 'Saved!' : 'Save Protocol'}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <label className="block">
            <span className="mb-2 block text-[13px] font-medium text-ink-muted">Exercise Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={fieldClass} />
          </label>

          <div>
            <span className="mb-2 block text-[13px] font-medium text-ink-muted">Target Muscle Group</span>
            <div className="flex flex-wrap gap-2">
              {MUSCLE_TAGS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  className={clsx(
                    'rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors duration-200',
                    tags.includes(tag) ? 'bg-accent/10 text-accent' : 'bg-surface-secondary text-ink-muted hover:bg-surface-hover',
                  )}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="mb-2 block text-[13px] font-medium text-ink-muted">Target Sets</span>
              <input type="number" value={sets} min={1} onChange={(e) => setSets(Number(e.target.value))} className={fieldClass} />
            </label>
            <label className="block">
              <span className="mb-2 block text-[13px] font-medium text-ink-muted">Target Reps</span>
              <input type="number" value={reps} min={1} onChange={(e) => setReps(Number(e.target.value))} className={fieldClass} />
            </label>
          </div>

          <label className="block">
            <span className="mb-2 block text-[13px] font-medium text-ink-muted">Setup Instructions Editor</span>
            <div className="rounded-xl bg-surface-secondary ring-1 ring-transparent transition-all duration-200 focus-within:ring-accent/50">
              <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
                {[Bold, Italic, List].map((Icon, i) => (
                  <button
                    key={i}
                    type="button"
                    className="rounded p-1.5 text-ink-faint transition-colors duration-200 hover:bg-surface-hover hover:text-ink"
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </button>
                ))}
              </div>
              <textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                rows={3}
                className="w-full resize-none bg-transparent px-4 py-3 text-[14px] text-ink outline-none placeholder:text-ink-faint"
                placeholder="Write pod placement guidelines for the patient…"
              />
            </div>
          </label>
        </div>

        <div className="flex flex-col gap-7 rounded-xl bg-surface-secondary p-6">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Biomechanical Thresholds</p>
          <RangeSlider label="Min/Max Joint ROM Range" valueMin={romMin} valueMax={romMax} min={0} max={180} onChangeMin={setRomMin} onChangeMax={setRomMax} />
          <Slider label="Fault Angle Threshold" value={faultThreshold} min={1} max={30} unit="° deviation" onChange={setFaultThreshold} tone="amber" />
          <Slider label="Target EMG %MVC" value={targetEmg} min={0} max={100} unit="%" onChange={setTargetEmg} />

          <div className="mt-auto rounded-lg bg-surface p-3.5 text-[13px] leading-relaxed text-ink-faint">
            A live skeleton segment turns <span className="font-medium text-crimson">red</span> when deviation exceeds{' '}
            <span className="font-medium text-ink">{faultThreshold}°</span>, and EMG bars flag{' '}
            <span className="font-medium text-ink">below {Math.round(targetEmg * 0.55)}%</span> activation as weak.
          </div>
        </div>
      </div>
    </Card>
  )
}
