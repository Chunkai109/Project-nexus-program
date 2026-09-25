import type { Dispatch, SetStateAction } from 'react'
import { Bold, Check, ChevronDown, Italic, List, X } from 'lucide-react'
import { clsx } from 'clsx'
import { Button } from '@/components/ui/Button'
import { Slider } from '@/components/ui/Slider'
import { RangeSlider } from '@/components/ui/RangeSlider'
import { RadialGauge } from '@/components/charts/RadialGauge'
import { BodyMap } from '@/components/body/BodyMap'
import { PODS } from '@/lib/mockData'
import { podLabel, podSide } from '@/lib/podUtils'
import type { ExerciseFormState } from '@/lib/useExerciseForm'
import type { AngleConfig, PatientRecord, PodId } from '@/types'

const MUSCLE_TAGS = ['Quadriceps', 'Hamstrings', 'Glutes', 'Calves', 'Stabilizers', 'Ankle Complex', 'Core']

const fieldClass =
  'w-full rounded-xl bg-surface-secondary px-4 py-3 text-[14px] text-ink outline-none ring-1 ring-transparent transition-all duration-200 focus:ring-accent/50'

/**
 * The full set of fields behind creating or fine-tuning an exercise —
 * title, assignment, muscle tags, sets/reps, notes, and the sensor-node
 * angle configuration. Shared by ProtocolBuilder's "New Exercise" flow and
 * ExerciseDetail's edit flow so a physio sees the identical form either way.
 */
export function ExerciseFormFields({
  form,
  setForm,
  patients,
  toggleTag,
  toggleDraftNode,
  draftValid,
  draftSideMismatch,
  confirmAngle,
  removeAngleConfig,
  loadAngleIntoDraft,
}: {
  form: ExerciseFormState
  setForm: Dispatch<SetStateAction<ExerciseFormState>>
  patients: PatientRecord[]
  toggleTag: (tag: string) => void
  toggleDraftNode: (id: PodId) => void
  draftValid: boolean
  draftSideMismatch: boolean
  confirmAngle: () => void
  removeAngleConfig: (id: string) => void
  loadAngleIntoDraft: (c: AngleConfig) => void
}) {
  return (
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

        <label className="block">
          <span className="mb-2 block text-[13px] font-medium text-ink-muted">Assign to Patient</span>
          <div className="relative">
            <select
              value={form.assignedPatientId ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, assignedPatientId: e.target.value || null }))}
              className={clsx(fieldClass, 'appearance-none pr-9')}
            >
              <option value="">All Patients</option>
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.email}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          </div>
          {patients.length === 0 && (
            <p className="mt-1.5 text-[12px] text-ink-faint">
              No patients have signed in yet — this exercise will be visible to whoever signs in until you assign it.
            </p>
          )}
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
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Angle Configuration</p>
            <span
              className={clsx(
                'flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
                form.angleConfigs.length > 0 ? 'bg-emerald/10 text-emerald' : 'bg-surface text-ink-faint',
              )}
            >
              {form.angleConfigs.length > 0 && <Check className="h-3 w-3" />}
              {form.angleConfigs.length > 0 ? `${form.angleConfigs.length} Confirmed` : 'Pending'}
            </span>
          </div>
          <p className="mb-4 text-[13px] text-ink-muted">
            Tap two sensor nodes, dial in the ROM range below, then confirm to save it as a tracked angle for this exercise.
          </p>
          <BodyMap pods={PODS} selectedPods={form.draftNodes} onSelect={(id) => toggleDraftNode(id as PodId)} height={220} />
          <div className="mt-4 text-center text-[13px]">
            {form.draftNodes.length === 0 && <span className="text-ink-faint">No nodes selected yet</span>}
            {form.draftNodes.length === 1 && (
              <span className="text-ink-muted">{podLabel(form.draftNodes[0])} selected — pick one more node</span>
            )}
            {form.draftNodes.length === 2 && draftValid && (
              <span className="font-medium text-accent">
                {podLabel(form.draftNodes[0])} ↔ {podLabel(form.draftNodes[1])} · Monitoring {podSide(form.draftNodes[0])} side
              </span>
            )}
            {draftSideMismatch && (
              <span className="font-medium text-crimson">Pick two nodes on the same side (both left or both right).</span>
            )}
          </div>
        </div>

        <div className="h-px bg-border" />

        <div className="flex flex-col items-center gap-1 rounded-lg bg-surface p-4">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Angle Customisation Preview</p>
          <RadialGauge
            value={(form.draftMin + form.draftMax) / 2}
            min={0}
            max={180}
            targetMin={form.draftMin}
            targetMax={form.draftMax}
            label={draftValid ? `${podLabel(form.draftNodes[0])} ↔ ${podLabel(form.draftNodes[1])}` : 'Select two nodes to preview'}
            size={160}
          />
          <div className="w-full">
            <RangeSlider
              label="Min/Max Joint ROM Range"
              valueMin={form.draftMin}
              valueMax={form.draftMax}
              min={0}
              max={180}
              onChangeMin={(v) => setForm((f) => ({ ...f, draftMin: v }))}
              onChangeMax={(v) => setForm((f) => ({ ...f, draftMax: v }))}
            />
          </div>
          <div className="w-full">
            <Slider
              label="Fault Angle Threshold"
              value={form.draftFaultThresholdDeg}
              min={1}
              max={30}
              unit="° deviation"
              onChange={(v) => setForm((f) => ({ ...f, draftFaultThresholdDeg: v }))}
              tone="amber"
            />
          </div>
          <Button size="sm" className="mt-2 w-full" onClick={confirmAngle} disabled={!draftValid}>
            <Check className="h-3.5 w-3.5" />
            Confirm This Angle
          </Button>
        </div>

        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            Confirmed Angles ({form.angleConfigs.length})
          </p>
          {form.angleConfigs.length === 0 ? (
            <p className="rounded-lg bg-surface p-3.5 text-center text-[13px] text-ink-faint">
              No angles confirmed yet — set one above and it'll be saved as a property of this exercise.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {form.angleConfigs.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3 rounded-lg bg-surface px-3.5 py-2.5">
                  <button
                    type="button"
                    onClick={() => loadAngleIntoDraft(c)}
                    className="flex min-w-0 items-center gap-1.5 text-left text-[13px] text-ink"
                    title="Load into the editor above — confirming again will override this angle"
                  >
                    <Check className="h-3.5 w-3.5 flex-shrink-0 text-emerald" />
                    <span className="truncate">
                      {podLabel(c.nodeA)} ↔ {podLabel(c.nodeB)}
                    </span>
                    <span className="flex-shrink-0 font-medium text-accent">
                      · {c.targetMin}°–{c.targetMax}° · ±{c.faultThresholdDeg}° fault
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => removeAngleConfig(c.id)}
                    className="flex-shrink-0 rounded p-1 text-ink-faint transition-colors duration-200 hover:bg-surface-hover hover:text-crimson"
                    aria-label={`Remove ${podLabel(c.nodeA)} to ${podLabel(c.nodeB)} angle`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="h-px bg-border" />

        <Slider
          label="Target EMG %MVC"
          value={form.targetEmgMvc}
          min={0}
          max={100}
          unit="%"
          onChange={(v) => setForm((f) => ({ ...f, targetEmgMvc: v }))}
        />

        <div className="mt-auto rounded-lg bg-surface p-3.5 text-[13px] leading-relaxed text-ink-faint">
          A live skeleton segment turns <span className="font-medium text-crimson">red</span> when deviation exceeds each
          confirmed angle's own fault threshold, and EMG bars flag{' '}
          <span className="font-medium text-ink">below {Math.round(form.targetEmgMvc * 0.55)}%</span> activation as weak.
        </div>
      </div>
    </div>
  )
}
