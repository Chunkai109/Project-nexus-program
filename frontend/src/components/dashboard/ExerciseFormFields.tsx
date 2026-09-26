import { useState, type Dispatch, type SetStateAction } from 'react'
import { ArrowLeft, ArrowRight, Bold, Check, ChevronDown, Italic, List, Save, X } from 'lucide-react'
import { clsx } from 'clsx'
import { Button } from '@/components/ui/Button'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { Slider } from '@/components/ui/Slider'
import { RangeSlider } from '@/components/ui/RangeSlider'
import { RadialGauge } from '@/components/charts/RadialGauge'
import { JointPicker } from '@/components/body/JointPicker'
import { MuscleGroupPicker } from '@/components/body/MuscleGroupPicker'
import { JOINT_PRESETS } from '@/lib/joints'
import { MUSCLE_GROUPS, muscleLabel } from '@/lib/muscles'
import { podLabel } from '@/lib/podUtils'
import type { ExerciseFormState } from '@/lib/useExerciseForm'
import type { AngleConfig, PatientRecord } from '@/types'

const MUSCLE_TAGS = MUSCLE_GROUPS.map((g) => g.label)

const fieldClass =
  'w-full rounded-xl bg-surface-secondary px-4 py-3 text-[14px] text-ink outline-none ring-1 ring-transparent transition-all duration-200 focus:ring-accent/50'

const WIZARD_STEPS = [{ label: 'Basics' }, { label: 'Angle Configuration' }, { label: 'EMG Activation' }]

type WizardStep = 'basics' | 'angles' | 'emg'

/**
 * A 3-step wizard behind creating or fine-tuning an exercise — basics, then
 * joint angle configuration, then EMG activation targets — so a physio sees
 * one focused page at a time instead of every field at once. Shared by
 * ProtocolBuilder's "New Exercise" flow and ExerciseFineTune's edit flow so
 * both render the identical steps.
 */
export function ExerciseFormFields({
  form,
  setForm,
  patients,
  toggleTag,
  selectDraftJoint,
  draftValid,
  confirmAngle,
  removeAngleConfig,
  loadAngleIntoDraft,
  selectDraftMuscleGroup,
  selectDraftMuscle,
  setDraftMuscleEmgPct,
  confirmMuscleEmgTarget,
  removeMuscleEmgTarget,
  canSave,
  onSave,
  onCancel,
  saveLabel,
}: {
  form: ExerciseFormState
  setForm: Dispatch<SetStateAction<ExerciseFormState>>
  patients: PatientRecord[]
  toggleTag: (tag: string) => void
  selectDraftJoint: (jointId: string) => void
  draftValid: boolean
  confirmAngle: () => void
  removeAngleConfig: (id: string) => void
  loadAngleIntoDraft: (c: AngleConfig) => void
  selectDraftMuscleGroup: (groupId: string) => void
  selectDraftMuscle: (muscleId: string) => void
  setDraftMuscleEmgPct: (pct: number) => void
  confirmMuscleEmgTarget: () => void
  removeMuscleEmgTarget: (muscleId: string) => void
  canSave: boolean
  onSave: () => void
  onCancel?: () => void
  saveLabel: string
}) {
  const [step, setStep] = useState<WizardStep>('basics')
  const stepIndex = step === 'basics' ? 0 : step === 'angles' ? 1 : 2
  const draftJoint = JOINT_PRESETS.find((p) => p.id === form.draftJointId)
  const draftGroup = MUSCLE_GROUPS.find((g) => g.id === form.draftMuscleGroupId)

  return (
    <div>
      <Breadcrumb steps={WIZARD_STEPS} activeIndex={stepIndex} />

      <div className="mt-8">
        {step === 'basics' && (
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
            </div>

            <div className="flex flex-col gap-6">
              <label className="block">
                <span className="mb-2 block text-[13px] font-medium text-ink-muted">Therapist Note (shown to patient)</span>
                <textarea
                  value={form.therapistNote}
                  onChange={(e) => setForm((f) => ({ ...f, therapistNote: e.target.value }))}
                  rows={4}
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
                    rows={9}
                    className="w-full resize-none bg-transparent px-4 py-3 text-[14px] text-ink outline-none placeholder:text-ink-faint"
                    placeholder="Write pod placement guidelines for the patient…"
                  />
                </div>
              </label>
            </div>
          </div>
        )}

        {step === 'angles' && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="rounded-xl bg-surface-secondary p-6">
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
                Tap a joint below, dial in the ROM range, then confirm to save it as a tracked angle for this exercise.
              </p>
              <JointPicker selectedJointId={form.draftJointId} onSelect={selectDraftJoint} height={220} />
              <div className="mt-4 text-center text-[13px]">
                {!draftJoint && <span className="text-ink-faint">No joint selected yet</span>}
                {draftJoint && <span className="font-medium text-accent">{draftJoint.label} selected</span>}
              </div>
            </div>

            <div className="flex flex-col items-center gap-1 rounded-xl bg-surface-secondary p-6">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Angle Customisation Preview</p>
              <RadialGauge
                value={(form.draftMin + form.draftMax) / 2}
                min={0}
                max={180}
                targetMin={form.draftMin}
                targetMax={form.draftMax}
                label={draftJoint ? draftJoint.label : 'Select a joint to preview'}
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

            <div className="lg:col-span-2">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                Confirmed Angles ({form.angleConfigs.length})
              </p>
              {form.angleConfigs.length === 0 ? (
                <p className="rounded-lg bg-surface-secondary p-3.5 text-center text-[13px] text-ink-faint">
                  No angles confirmed yet — set one above and it'll be saved as a property of this exercise.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {form.angleConfigs.map((c) => (
                    <div key={c.id} className="flex items-center justify-between gap-3 rounded-lg bg-surface-secondary px-3.5 py-2.5">
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
              <div className="mt-4 rounded-lg bg-surface-secondary p-3.5 text-[13px] leading-relaxed text-ink-faint">
                A live skeleton segment turns <span className="font-medium text-crimson">red</span> when deviation exceeds each
                confirmed angle's own fault threshold.
              </div>
            </div>
          </div>
        )}

        {step === 'emg' && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="rounded-xl bg-surface-secondary p-6">
              <div className="mb-1 flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Muscle Selection</p>
                <span
                  className={clsx(
                    'flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
                    form.muscleEmgTargets.length > 0 ? 'bg-emerald/10 text-emerald' : 'bg-surface text-ink-faint',
                  )}
                >
                  {form.muscleEmgTargets.length > 0 && <Check className="h-3 w-3" />}
                  {form.muscleEmgTargets.length > 0 ? `${form.muscleEmgTargets.length} Set` : 'None set'}
                </span>
              </div>
              <p className="mb-4 text-[13px] text-ink-muted">
                Drag to rotate the figure, then tap a node to reveal its muscle group — Chest and Back sit on opposite
                sides, so rotate to reach the back. Pick the specific muscle from the dropdown below.
              </p>
              <MuscleGroupPicker selectedGroupId={form.draftMuscleGroupId} onSelect={selectDraftMuscleGroup} height={280} />
              <div className="my-4 text-center text-[13px]">
                {!draftGroup && <span className="text-ink-faint">No muscle group selected yet</span>}
                {draftGroup && <span className="font-medium text-accent">{draftGroup.label} selected</span>}
              </div>
              {draftGroup && (
                <label className="block">
                  <span className="mb-2 block text-[13px] font-medium text-ink-muted">Muscle</span>
                  <div className="relative">
                    <select
                      value={form.draftMuscleId ?? ''}
                      onChange={(e) => selectDraftMuscle(e.target.value)}
                      className={clsx(fieldClass, 'appearance-none pr-9')}
                    >
                      <option value="" disabled>
                        Select a muscle…
                      </option>
                      {draftGroup.muscles.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
                  </div>
                </label>
              )}
            </div>

            <div className="flex flex-col items-center gap-2 rounded-xl bg-surface-secondary p-6">
              <p className="mb-1 self-start text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                Target EMG Activation
              </p>
              {form.draftMuscleId ? (
                <>
                  <p className="mb-2 self-start text-[13px] font-medium text-accent">{muscleLabel(form.draftMuscleId)}</p>
                  <div className="w-full">
                    <Slider
                      label="Target EMG %MVC"
                      value={form.draftMuscleEmgPct}
                      min={0}
                      max={100}
                      unit="%"
                      onChange={setDraftMuscleEmgPct}
                    />
                  </div>
                  <Button size="sm" className="mt-2 w-full" onClick={confirmMuscleEmgTarget}>
                    <Check className="h-3.5 w-3.5" />
                    Confirm This Muscle Target
                  </Button>
                </>
              ) : (
                <p className="w-full rounded-lg bg-surface p-3.5 text-center text-[13px] text-ink-faint">
                  Select a muscle group and muscle to set its target.
                </p>
              )}
            </div>

            <div className="lg:col-span-2">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                Confirmed Muscle Targets ({form.muscleEmgTargets.length})
              </p>
              {form.muscleEmgTargets.length === 0 ? (
                <p className="rounded-lg bg-surface-secondary p-3.5 text-center text-[13px] text-ink-faint">
                  No muscle targets set yet — set one above and it'll be saved as a property of this exercise.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {form.muscleEmgTargets.map((t) => (
                    <div key={t.muscleId} className="flex items-center justify-between gap-3 rounded-lg bg-surface-secondary px-3.5 py-2.5">
                      <span className="flex min-w-0 items-center gap-1.5 text-left text-[13px] text-ink">
                        <Check className="h-3.5 w-3.5 flex-shrink-0 text-emerald" />
                        <span className="truncate">{muscleLabel(t.muscleId)}</span>
                        <span className="flex-shrink-0 font-medium text-accent">· {t.targetMvc}% MVC</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => removeMuscleEmgTarget(t.muscleId)}
                        className="flex-shrink-0 rounded p-1 text-ink-faint transition-colors duration-200 hover:bg-surface-hover hover:text-crimson"
                        aria-label={`Remove ${muscleLabel(t.muscleId)} EMG target`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-4 rounded-lg bg-surface-secondary p-3.5 text-[13px] leading-relaxed text-ink-faint">
                Each muscle's EMG bar flags below <span className="font-medium text-ink">55% of its own target</span> activation
                as weak.
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="mt-8 flex items-center justify-between border-t border-border pt-6">
        <div>
          {step !== 'basics' && (
            <Button variant="ghost" size="sm" onClick={() => setStep(step === 'emg' ? 'angles' : 'basics')}>
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          {onCancel && (
            <Button variant="ghost" size="sm" onClick={onCancel}>
              <X className="h-3.5 w-3.5" />
              Cancel
            </Button>
          )}
          {step !== 'emg' ? (
            <Button size="sm" onClick={() => setStep(step === 'basics' ? 'angles' : 'emg')} disabled={step === 'basics' && !form.title.trim()}>
              Next
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button size="sm" onClick={onSave} disabled={!canSave}>
              <Save className="h-3.5 w-3.5" />
              {saveLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
