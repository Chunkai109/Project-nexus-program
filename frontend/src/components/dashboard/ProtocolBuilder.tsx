import { useState } from 'react'
import { Bold, Check, Italic, List, Pencil, Plus, Save, Trash2, X } from 'lucide-react'
import { clsx } from 'clsx'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Slider } from '@/components/ui/Slider'
import { RangeSlider } from '@/components/ui/RangeSlider'
import { RadialGauge } from '@/components/charts/RadialGauge'
import { BodyMap } from '@/components/body/BodyMap'
import { useAppData, type NewExercise } from '@/lib/data/AppDataContext'
import { PODS } from '@/lib/mockData'
import { podLabel, podSide } from '@/lib/podUtils'
import type { Exercise, PodId } from '@/types'

const MUSCLE_TAGS = ['Quadriceps', 'Hamstrings', 'Glutes', 'Calves', 'Stabilizers', 'Ankle Complex', 'Core']

const fieldClass =
  'w-full rounded-xl bg-surface-secondary px-4 py-3 text-[14px] text-ink outline-none ring-1 ring-transparent transition-all duration-200 focus:ring-accent/50'

interface FormState {
  title: string
  muscleGroups: string[]
  sets: number
  reps: number
  targetRomMin: number
  targetRomMax: number
  faultThresholdDeg: number
  targetEmgMvc: number
  therapistNote: string
  setupInstructions: string
  estMinutes: number
  nodes: PodId[]
}

function blankForm(): FormState {
  return {
    title: '',
    muscleGroups: [],
    sets: 3,
    reps: 12,
    targetRomMin: 90,
    targetRomMax: 110,
    faultThresholdDeg: 8,
    targetEmgMvc: 65,
    therapistNote: '',
    setupInstructions: '',
    estMinutes: 10,
    nodes: [],
  }
}

function formFromExercise(ex: Exercise): FormState {
  return {
    title: ex.title,
    muscleGroups: ex.muscleGroups,
    sets: ex.sets,
    reps: ex.reps,
    targetRomMin: ex.targetRomMin,
    targetRomMax: ex.targetRomMax,
    faultThresholdDeg: ex.faultThresholdDeg,
    targetEmgMvc: ex.targetEmgMvc,
    therapistNote: ex.therapistNote,
    setupInstructions: ex.setupInstructions,
    estMinutes: ex.estMinutes,
    nodes: [ex.nodeA, ex.nodeB],
  }
}

export function ProtocolBuilder() {
  const { exercises, addExercise, updateExercise, deleteExercise } = useAppData()
  const [mode, setMode] = useState<'list' | 'form'>('list')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(blankForm())
  const [saved, setSaved] = useState(false)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  function confirmDelete(id: string) {
    deleteExercise(id)
    setPendingDeleteId(null)
  }

  function startCreate() {
    setEditingId(null)
    setForm(blankForm())
    setMode('form')
  }

  function startEdit(ex: Exercise) {
    setEditingId(ex.id)
    setForm(formFromExercise(ex))
    setMode('form')
  }

  function toggleTag(tag: string) {
    setForm((f) => ({
      ...f,
      muscleGroups: f.muscleGroups.includes(tag) ? f.muscleGroups.filter((t) => t !== tag) : [...f.muscleGroups, tag],
    }))
  }

  function toggleNode(id: PodId) {
    setForm((f) => {
      if (f.nodes.includes(id)) return { ...f, nodes: f.nodes.filter((n) => n !== id) }
      if (f.nodes.length < 2) return { ...f, nodes: [...f.nodes, id] }
      return { ...f, nodes: [id] }
    })
  }

  const nodesValid = form.nodes.length === 2 && podSide(form.nodes[0]) === podSide(form.nodes[1])
  const sideMismatch = form.nodes.length === 2 && !nodesValid
  const canSave = form.title.trim().length > 0 && nodesValid

  function handleSave() {
    if (!canSave) return
    const payload: NewExercise = {
      title: form.title.trim(),
      muscleGroups: form.muscleGroups,
      sets: form.sets,
      reps: form.reps,
      targetRomMin: form.targetRomMin,
      targetRomMax: form.targetRomMax,
      faultThresholdDeg: form.faultThresholdDeg,
      targetEmgMvc: form.targetEmgMvc,
      therapistNote: form.therapistNote,
      setupInstructions: form.setupInstructions,
      estMinutes: form.estMinutes,
      nodeA: form.nodes[0],
      nodeB: form.nodes[1],
    }
    if (editingId) {
      updateExercise(editingId, payload)
    } else {
      addExercise(payload)
    }
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
    setMode('list')
  }

  if (mode === 'list') {
    return (
      <Card className="p-7">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">Exercise Protocols</h2>
            <p className="text-[13px] text-ink-faint">
              {exercises.length === 0
                ? 'Nothing created yet — patients see exactly what you publish here.'
                : `${exercises.length} protocol${exercises.length === 1 ? '' : 's'} visible to patients right now.`}
            </p>
          </div>
          <Button size="sm" onClick={startCreate}>
            <Plus className="h-3.5 w-3.5" />
            New Exercise
          </Button>
        </div>

        {exercises.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl bg-surface-secondary py-14 text-center">
            <p className="text-[14px] font-medium text-ink">No exercises yet</p>
            <p className="max-w-xs text-[13px] text-ink-faint">
              Create your first protocol and it will immediately appear on the patient's exercise list.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {exercises.map((ex) => (
              <div key={ex.id} className="flex items-center justify-between gap-4 rounded-xl bg-surface-secondary p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-[14px] font-semibold text-ink">{ex.title}</p>
                    <Badge tone="accent">{ex.sets}×{ex.reps}</Badge>
                  </div>
                  <p className="mt-0.5 truncate text-[13px] text-ink-faint">
                    {podLabel(ex.nodeA)} ↔ {podLabel(ex.nodeB)} · {ex.targetRomMin}°–{ex.targetRomMax}° ROM
                  </p>
                </div>
                {pendingDeleteId === ex.id ? (
                  <div className="flex flex-shrink-0 items-center gap-2">
                    <span className="text-[13px] text-ink-muted">Delete this exercise?</span>
                    <Button variant="ghost" size="sm" onClick={() => setPendingDeleteId(null)}>
                      Cancel
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => confirmDelete(ex.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-shrink-0 gap-2">
                    <Button variant="ghost" size="sm" onClick={() => startEdit(ex)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setPendingDeleteId(ex.id)}>
                      <Trash2 className="h-3.5 w-3.5 text-crimson" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {saved && <p className="mt-4 text-center text-[13px] font-medium text-emerald">Saved.</p>}
      </Card>
    )
  }

  return (
    <Card className="p-7">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">{editingId ? 'Edit Exercise' : 'New Exercise'}</h2>
          <p className="text-[13px] text-ink-faint">Define biomechanical thresholds prescribed for this exercise</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => setMode('list')}>
            <X className="h-3.5 w-3.5" />
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!canSave}>
            <Save className="h-3.5 w-3.5" />
            Save Protocol
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <label className="block">
            <span className="mb-2 block text-[13px] font-medium text-ink-muted">Exercise Title</span>
            <input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Bilateral Squat Rehab"
              className={fieldClass}
            />
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
                    form.muscleGroups.includes(tag)
                      ? 'bg-accent/10 text-accent'
                      : 'bg-surface-secondary text-ink-muted hover:bg-surface-hover',
                  )}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <label className="block">
              <span className="mb-2 block text-[13px] font-medium text-ink-muted">Sets</span>
              <input
                type="number"
                value={form.sets}
                min={1}
                onChange={(e) => setForm((f) => ({ ...f, sets: Number(e.target.value) }))}
                className={fieldClass}
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-[13px] font-medium text-ink-muted">Reps</span>
              <input
                type="number"
                value={form.reps}
                min={1}
                onChange={(e) => setForm((f) => ({ ...f, reps: Number(e.target.value) }))}
                className={fieldClass}
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-[13px] font-medium text-ink-muted">Est. Minutes</span>
              <input
                type="number"
                value={form.estMinutes}
                min={1}
                onChange={(e) => setForm((f) => ({ ...f, estMinutes: Number(e.target.value) }))}
                className={fieldClass}
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-2 block text-[13px] font-medium text-ink-muted">Therapist Note (shown to patient)</span>
            <textarea
              value={form.therapistNote}
              onChange={(e) => setForm((f) => ({ ...f, therapistNote: e.target.value }))}
              rows={2}
              className={clsx(fieldClass, 'resize-none')}
              placeholder="e.g. Focus on symmetric weight distribution."
            />
          </label>

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
                value={form.setupInstructions}
                onChange={(e) => setForm((f) => ({ ...f, setupInstructions: e.target.value }))}
                rows={3}
                className="w-full resize-none bg-transparent px-4 py-3 text-[14px] text-ink outline-none placeholder:text-ink-faint"
                placeholder="Write pod placement guidelines for the patient…"
              />
            </div>
          </label>
        </div>

        <div className="flex flex-col gap-7 rounded-xl bg-surface-secondary p-6">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Reference Nodes</p>
              <span
                className={clsx(
                  'flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
                  nodesValid ? 'bg-emerald/10 text-emerald' : 'bg-surface text-ink-faint',
                )}
              >
                {nodesValid && <Check className="h-3 w-3" />}
                {nodesValid ? 'Configured' : 'Pending'}
              </span>
            </div>
            <p className="mb-4 text-[13px] text-ink-muted">
              Tap the two sensor nodes whose relative angle defines this exercise's range of motion.
            </p>
            <BodyMap pods={PODS} selectedPods={form.nodes} onSelect={(id) => toggleNode(id as PodId)} height={220} />
            <div className="mt-4 text-center text-[13px]">
              {form.nodes.length === 0 && <span className="text-ink-faint">No nodes selected yet</span>}
              {form.nodes.length === 1 && (
                <span className="text-ink-muted">
                  {podLabel(form.nodes[0])} selected — pick one more node
                </span>
              )}
              {form.nodes.length === 2 && nodesValid && (
                <span className="font-medium text-accent">
                  {podLabel(form.nodes[0])} ↔ {podLabel(form.nodes[1])} · Monitoring {podSide(form.nodes[0])} side
                </span>
              )}
              {sideMismatch && (
                <span className="font-medium text-crimson">Pick two nodes on the same side (both left or both right).</span>
              )}
            </div>
          </div>

          <div className="h-px bg-border" />

          <div className="flex flex-col items-center gap-1 rounded-lg bg-surface p-4">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              Angle Customisation Preview
            </p>
            <RadialGauge
              value={(form.targetRomMin + form.targetRomMax) / 2}
              min={0}
              max={180}
              targetMin={form.targetRomMin}
              targetMax={form.targetRomMax}
              label={nodesValid ? `${podLabel(form.nodes[0])} ↔ ${podLabel(form.nodes[1])}` : 'Select two nodes to preview'}
              size={160}
            />
          </div>

          <div className="h-px bg-border" />

          <RangeSlider
            label="Min/Max Joint ROM Range"
            valueMin={form.targetRomMin}
            valueMax={form.targetRomMax}
            min={0}
            max={180}
            onChangeMin={(v) => setForm((f) => ({ ...f, targetRomMin: v }))}
            onChangeMax={(v) => setForm((f) => ({ ...f, targetRomMax: v }))}
          />
          <Slider
            label="Fault Angle Threshold"
            value={form.faultThresholdDeg}
            min={1}
            max={30}
            unit="° deviation"
            onChange={(v) => setForm((f) => ({ ...f, faultThresholdDeg: v }))}
            tone="amber"
          />
          <Slider
            label="Target EMG %MVC"
            value={form.targetEmgMvc}
            min={0}
            max={100}
            unit="%"
            onChange={(v) => setForm((f) => ({ ...f, targetEmgMvc: v }))}
          />

          <div className="mt-auto rounded-lg bg-surface p-3.5 text-[13px] leading-relaxed text-ink-faint">
            A live skeleton segment turns <span className="font-medium text-crimson">red</span> when deviation exceeds{' '}
            <span className="font-medium text-ink">{form.faultThresholdDeg}°</span>, and EMG bars flag{' '}
            <span className="font-medium text-ink">below {Math.round(form.targetEmgMvc * 0.55)}%</span> activation as weak.
          </div>
        </div>
      </div>
    </Card>
  )
}
