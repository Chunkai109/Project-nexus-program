import { useState, type Dispatch, type SetStateAction } from 'react'
import { AlertTriangle, ArrowLeft, ArrowRight, Bold, Check, ChevronDown, Italic, List, Loader2, Save, X } from 'lucide-react'
import { clsx } from 'clsx'
import { Button } from '@/components/ui/Button'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { HoverExplain } from '@/components/ui/HoverExplain'
import { Slider } from '@/components/ui/Slider'
import { RangeSlider } from '@/components/ui/RangeSlider'
import { RadialGauge } from '@/components/charts/RadialGauge'
import { JointPicker } from '@/components/body/JointPicker'
import { MuscleGroupPicker } from '@/components/body/MuscleGroupPicker'
import { JOINT_PRESETS, jointPresetForPair } from '@/lib/joints'
import { MUSCLE_GROUPS, muscleLabel } from '@/lib/muscles'
import { podLabel } from '@/lib/podUtils'
import { DRIFT_LIMIT_MAX, DRIFT_LIMIT_MIN, DRIFT_LIMIT_WARN_BELOW, parseDriftLimit, type ExerciseFormState } from '@/lib/useExerciseForm'
import { NotUsedYetTag } from './PlanTags'
import type { AngleConfig, Exercise } from '@/types'

const MUSCLE_TAGS = MUSCLE_GROUPS.map((g) => g.label)

const fieldClass =
  'w-full rounded-xl bg-surface-secondary px-4 py-3 text-[14px] text-ink outline-none ring-1 ring-transparent transition-all duration-200 focus:ring-accent/50'

const WIZARD_STEPS = [{ label: 'Basics' }, { label: 'Angle Configuration' }, { label: 'EMG Activation' }]

type WizardStep = 'basics' | 'angles' | 'emg'

/** 'preset' = a general exercise in the Exercise Creator; 'patientPlan' = one patient's own copy. */
export type ExerciseFormMode = 'preset' | 'patientPlan'

function clip(text: string): string {
  const t = text.trim()
  if (!t) return '—'
  return t.length > 40 ? `${t.slice(0, 40)}…` : t
}

/** Grey "Preset: 10" line under a patient-plan field that differs from its preset. */
function PresetHint({ show, value }: { show: boolean; value: string | number }) {
  if (!show) return null
  return <p className="mt-1.5 text-[12px] text-ink-muted">Preset: {value}</p>
}

/** Upper-arm drift limit: whole degrees, 1–90, with a warning (not a block) below 20°. */
function DriftLimitField({ value, onChange, presetValue }: { value: string; onChange: (v: string) => void; presetValue?: number }) {
  const parsed = parseDriftLimit(value)
  const invalid = parsed === null
  const low = parsed !== null && parsed < DRIFT_LIMIT_WARN_BELOW
  return (
    <div className="mt-6 rounded-xl bg-surface-secondary p-4">
      <label htmlFor="drift-limit" className="mb-2 block text-[13px] font-medium text-ink-muted">
        Upper-arm drift limit
      </label>
      <div className="flex w-32 items-center gap-2">
        <input
          id="drift-limit"
          type="text"
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalid}
          aria-describedby="drift-limit-help drift-limit-msg"
          className={clsx(fieldClass, 'bg-surface tabular-nums', invalid && 'ring-crimson/60')}
        />
        <span className="text-[14px] text-ink-muted">°</span>
      </div>
      <p id="drift-limit-help" className="mt-2 text-[12px] text-ink-muted">
        Upper-arm movement from 0° to this value is allowed. The fault fires above it.
      </p>
      <PresetHint show={presetValue !== undefined && parsed !== presetValue} value={`${presetValue}°`} />
      <div id="drift-limit-msg" aria-live="polite">
        {invalid && (
          <p className="mt-2 text-[12px] font-medium text-crimson-ink">
            Enter a whole number of degrees between {DRIFT_LIMIT_MIN} and {DRIFT_LIMIT_MAX}.
          </p>
        )}
        {low && (
          <p className="mt-2 flex items-center gap-1.5 text-[12px] font-medium text-amber-ink">
            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
            Below {DRIFT_LIMIT_WARN_BELOW}° fired on normal movement in rig testing.
          </p>
        )}
      </div>
    </div>
  )
}

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
  mode = 'preset',
  compareTo,
  saving = false,
  saveError,
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
  mode?: ExerciseFormMode
  /** patientPlan mode: the preset this plan came from, to show "Preset: …" under changed fields. */
  compareTo?: Exercise | null
  saving?: boolean
  saveError?: string | null
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
  const loadedConfig = draftJoint ? undefined : form.angleConfigs.find((c) => c.id === form.draftConfigId)
  const draftLabel = draftJoint ? draftJoint.label : loadedConfig ? `${podLabel(loadedConfig.nodeA)} ↔ ${podLabel(loadedConfig.nodeB)}` : null
  const confirmedJointIds = new Set(
    form.angleConfigs.map((c) => jointPresetForPair(c.nodeA, c.nodeB)?.id).filter((id): id is string => id != null),
  )
  const draftGroup = MUSCLE_GROUPS.find((g) => g.id === form.draftMuscleGroupId)
  const isPlan = mode === 'patientPlan'
  const preset = isPlan ? (compareTo ?? null) : null

  return (
    <div>
      <Breadcrumb steps={WIZARD_STEPS} activeIndex={stepIndex} />

      <div className="mt-8">
        {step === 'basics' && (
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            <div className="flex flex-col gap-6">
              <HoverExplain explanation="The exercise's display name, shown to patients on their exercise list and throughout this dashboard.">
                <label className="block">
                  <span className="mb-2 block text-[13px] font-medium text-ink-muted">Exercise Title</span>
                  <input
                    value={form.title}
                    onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                    placeholder="e.g. Bilateral Squat Rehab"
                    className={fieldClass}
                  />
                </label>
              </HoverExplain>

              <div>
                <span className="mb-2 block text-[13px] font-medium text-ink-muted">Target Muscle Group</span>
                <div className="flex flex-wrap gap-2">
                  {MUSCLE_TAGS.map((tag) => (
                    <HoverExplain
                      key={tag}
                      explanation={`Tags this exercise as targeting ${tag} — for reference only, doesn't affect sensor tracking.`}
                    >
                      <button
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
                    </HoverExplain>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <HoverExplain explanation="Number of sets the patient should complete per session.">
                  <label className="block">
                    <span className="mb-2 block text-[13px] font-medium text-ink-muted">Sets</span>
                    <input
                      type="number"
                      value={form.sets}
                      min={1}
                      onChange={(e) => setForm((f) => ({ ...f, sets: Number(e.target.value) }))}
                      className={fieldClass}
                    />
                    <PresetHint show={!!preset && form.sets !== preset.sets} value={preset?.sets ?? ''} />
                  </label>
                </HoverExplain>
                <HoverExplain explanation="Number of reps per set the patient should complete.">
                  <label className="block">
                    <span className="mb-2 block text-[13px] font-medium text-ink-muted">Reps</span>
                    <input
                      type="number"
                      value={form.reps}
                      min={1}
                      onChange={(e) => setForm((f) => ({ ...f, reps: Number(e.target.value) }))}
                      className={fieldClass}
                    />
                    <PresetHint show={!!preset && form.reps !== preset.reps} value={preset?.reps ?? ''} />
                  </label>
                </HoverExplain>
                <HoverExplain explanation="Estimated time to complete this exercise, shown to the patient before they start.">
                  <label className="block">
                    <span className="mb-2 block text-[13px] font-medium text-ink-muted">Est. Minutes</span>
                    <input
                      type="number"
                      value={form.estMinutes}
                      min={1}
                      onChange={(e) => setForm((f) => ({ ...f, estMinutes: Number(e.target.value) }))}
                      className={fieldClass}
                    />
                    <PresetHint show={!!preset && form.estMinutes !== preset.estMinutes} value={preset?.estMinutes ?? ''} />
                  </label>
                </HoverExplain>
              </div>
            </div>

            <div className="flex flex-col gap-6">
              <HoverExplain explanation="A short note shown directly to the patient on their exercise card — use it for form cues or reminders.">
                <label className="block">
                  <span className="mb-2 block text-[13px] font-medium text-ink-muted">Therapist Note (shown to patient)</span>
                  <textarea
                    value={form.therapistNote}
                    onChange={(e) => setForm((f) => ({ ...f, therapistNote: e.target.value }))}
                    rows={4}
                    className={clsx(fieldClass, 'resize-none')}
                    placeholder="e.g. Focus on symmetric weight distribution."
                  />
                  <PresetHint
                    show={!!preset && form.therapistNote.trim() !== preset.therapistNote.trim()}
                    value={clip(preset?.therapistNote ?? '')}
                  />
                </label>
              </HoverExplain>

              <label className="block">
                <span className="mb-2 block text-[13px] font-medium text-ink-muted">Setup Instructions Editor</span>
                <div className="rounded-xl bg-surface-secondary ring-1 ring-transparent transition-all duration-200 focus-within:ring-accent/50">
                  <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
                    {[Bold, Italic, List].map((Icon, i) => (
                      <HoverExplain key={i} explanation="Text formatting for the instructions below — not yet functional in this draft.">
                        <button
                          type="button"
                          className="rounded p-1.5 text-ink-faint transition-colors duration-200 hover:bg-surface-hover hover:text-ink"
                        >
                          <Icon className="h-3.5 w-3.5" />
                        </button>
                      </HoverExplain>
                    ))}
                  </div>
                  <HoverExplain explanation="Step-by-step pod placement guidance shown to the patient on the Sensor Setup screen.">
                    <textarea
                      value={form.setupInstructions}
                      onChange={(e) => setForm((f) => ({ ...f, setupInstructions: e.target.value }))}
                      rows={9}
                      className="w-full resize-none bg-transparent px-4 py-3 text-[14px] text-ink outline-none placeholder:text-ink-faint"
                      placeholder="Write pod placement guidelines for the patient…"
                    />
                  </HoverExplain>
                </div>
                <PresetHint
                  show={!!preset && form.setupInstructions.trim() !== preset.setupInstructions.trim()}
                  value={clip(preset?.setupInstructions ?? '')}
                />
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
                    form.angleConfigs.length > 0 ? 'bg-emerald/10 text-emerald-ink' : 'bg-surface text-ink-faint',
                  )}
                >
                  {form.angleConfigs.length > 0 && <Check className="h-3 w-3" />}
                  {form.angleConfigs.length > 0 ? `${form.angleConfigs.length} Confirmed` : 'Pending'}
                </span>
              </div>
              <JointPicker
                selectedJointId={form.draftJointId}
                onSelect={selectDraftJoint}
                confirmedJointIds={confirmedJointIds}
                height={280}
              />
              <div className="mt-4 text-center text-[13px]">
                {!draftLabel && <span className="text-ink-faint">No joint selected yet</span>}
                {draftLabel && <span className="font-medium text-accent">{draftLabel} selected</span>}
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
                label={draftLabel ?? 'Select a joint to preview'}
                size={160}
              />
              <HoverExplain
                className="w-full"
                explanation="Sets the target range-of-motion corridor (in degrees) the patient should reach for this joint each rep."
              >
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
              </HoverExplain>
              <HoverExplain
                className="w-full"
                explanation="How many degrees of deviation from the target angle counts as a form fault for this joint."
              >
                <div className="w-full">
                  <Slider
                    label={
                      isPlan ? (
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="whitespace-nowrap">Fault Angle Threshold</span>
                          <NotUsedYetTag />
                        </span>
                      ) : (
                        'Fault Angle Threshold'
                      )
                    }
                    value={form.draftFaultThresholdDeg}
                    min={1}
                    max={30}
                    unit="° deviation"
                    onChange={(v) => setForm((f) => ({ ...f, draftFaultThresholdDeg: v }))}
                    tone="amber"
                  />
                </div>
              </HoverExplain>
              <HoverExplain
                className="w-full"
                explanation="Saves the selected joint's target ROM and fault threshold as one of this exercise's tracked angles."
              >
                <Button size="sm" className="mt-2 w-full" onClick={confirmAngle} disabled={!draftValid}>
                  <Check className="h-3.5 w-3.5" />
                  Confirm This Angle
                </Button>
              </HoverExplain>
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
                      <HoverExplain explanation="Load this confirmed angle back into the editor above — confirming again will overwrite it.">
                        <button
                          type="button"
                          onClick={() => loadAngleIntoDraft(c)}
                          className="flex min-w-0 items-center gap-1.5 text-left text-[13px] text-ink"
                        >
                          <Check className="h-3.5 w-3.5 flex-shrink-0 text-emerald-ink" />
                          <span className="truncate">
                            {podLabel(c.nodeA)} ↔ {podLabel(c.nodeB)}
                          </span>
                          <span className="flex-shrink-0 font-medium text-accent">
                            · {c.targetMin}°–{c.targetMax}° · ±{c.faultThresholdDeg}° fault
                          </span>
                        </button>
                      </HoverExplain>
                      <HoverExplain explanation={`Remove the ${podLabel(c.nodeA)} ↔ ${podLabel(c.nodeB)} angle from this exercise.`}>
                        <button
                          type="button"
                          onClick={() => removeAngleConfig(c.id)}
                          className="flex-shrink-0 rounded p-1 text-ink-faint transition-colors duration-200 hover:bg-surface-hover hover:text-crimson-ink"
                          aria-label={`Remove ${podLabel(c.nodeA)} to ${podLabel(c.nodeB)} angle`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </HoverExplain>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-4 rounded-lg bg-surface-secondary p-3.5 text-[13px] leading-relaxed text-ink-faint">
                A live skeleton segment turns <span className="font-medium text-crimson-ink">red</span> when deviation exceeds each
                confirmed angle's own fault threshold.
              </div>
              <DriftLimitField
                value={form.driftToleranceInput}
                onChange={(v) => setForm((f) => ({ ...f, driftToleranceInput: v }))}
                presetValue={preset?.driftToleranceDeg}
              />
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
                    form.muscleEmgTargets.length > 0 ? 'bg-emerald/10 text-emerald-ink' : 'bg-surface text-ink-faint',
                  )}
                >
                  {form.muscleEmgTargets.length > 0 && <Check className="h-3 w-3" />}
                  {form.muscleEmgTargets.length > 0 ? `${form.muscleEmgTargets.length} Set` : 'None set'}
                </span>
              </div>
              <MuscleGroupPicker selectedGroupId={form.draftMuscleGroupId} onSelect={selectDraftMuscleGroup} height={280} />
              <div className="my-4 text-center text-[13px]">
                {!draftGroup && <span className="text-ink-faint">No muscle group selected yet</span>}
                {draftGroup && <span className="font-medium text-accent">{draftGroup.label} selected</span>}
              </div>
            </div>

            <div className="flex flex-col items-center gap-2 rounded-xl bg-surface-secondary p-6">
              <div className="mb-1 flex items-center gap-2 self-start">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Target EMG Activation</p>
                {isPlan && <NotUsedYetTag />}
              </div>
              {draftGroup ? (
                <>
                  <HoverExplain className="w-full" explanation="Choose which specific muscle (within the selected group) to set a target activation for.">
                    <label className="block w-full">
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
                  </HoverExplain>
                  {form.draftMuscleId ? (
                    <>
                      <HoverExplain
                        className="w-full"
                        explanation="The percentage of maximum voluntary contraction (%MVC) this muscle should reach during the exercise's concentric phase."
                      >
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
                      </HoverExplain>
                      <HoverExplain className="w-full" explanation="Saves the selected muscle's target %MVC activation for this exercise.">
                        <Button size="sm" className="mt-2 w-full" onClick={confirmMuscleEmgTarget}>
                          <Check className="h-3.5 w-3.5" />
                          Confirm This Muscle Target
                        </Button>
                      </HoverExplain>
                    </>
                  ) : (
                    <p className="w-full rounded-lg bg-surface p-3.5 text-center text-[13px] text-ink-faint">
                      Select a muscle above to set its target.
                    </p>
                  )}
                </>
              ) : (
                <p className="w-full rounded-lg bg-surface p-3.5 text-center text-[13px] text-ink-faint">
                  Select a muscle group to continue.
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
                        <Check className="h-3.5 w-3.5 flex-shrink-0 text-emerald-ink" />
                        <span className="truncate">{muscleLabel(t.muscleId)}</span>
                        <span className="flex-shrink-0 font-medium text-accent">· {t.targetMvc}% MVC</span>
                      </span>
                      <HoverExplain explanation={`Remove the ${muscleLabel(t.muscleId)} EMG target from this exercise.`}>
                        <button
                          type="button"
                          onClick={() => removeMuscleEmgTarget(t.muscleId)}
                          className="flex-shrink-0 rounded p-1 text-ink-faint transition-colors duration-200 hover:bg-surface-hover hover:text-crimson-ink"
                          aria-label={`Remove ${muscleLabel(t.muscleId)} EMG target`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </HoverExplain>
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

      {saveError && (
        <p role="alert" className="mt-8 rounded-lg bg-crimson/10 px-4 py-3 text-[13px] font-medium text-crimson-ink">
          {saveError}
        </p>
      )}
      <div className={clsx('flex items-center justify-between border-t border-border pt-6', saveError ? 'mt-4' : 'mt-8')}>
        <div>
          {step !== 'basics' && (
            <HoverExplain explanation="Return to the previous step without losing what you've entered.">
              <Button variant="ghost" size="sm" onClick={() => setStep(step === 'emg' ? 'angles' : 'basics')}>
                <ArrowLeft className="h-3.5 w-3.5" />
                Back
              </Button>
            </HoverExplain>
          )}
        </div>
        <div className="flex gap-2">
          {onCancel && (
            <HoverExplain explanation={isPlan ? 'Close the editor without saving.' : 'Discard this exercise and return to the Exercise Protocols list.'}>
              <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
                <X className="h-3.5 w-3.5" />
                Cancel
              </Button>
            </HoverExplain>
          )}
          {step !== 'emg' ? (
            <HoverExplain explanation="Continue to the next step of the wizard.">
              <Button size="sm" onClick={() => setStep(step === 'basics' ? 'angles' : 'emg')} disabled={
                  (step === 'basics' && !form.title.trim()) || (step === 'angles' && parseDriftLimit(form.driftToleranceInput) === null)
                }
              >
                Next
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </HoverExplain>
          ) : (
            <HoverExplain
              explanation={isPlan ? "Save this plan so it appears on the patient's exercise list." : 'Save this preset. Patients only see it once you add it to their Exercise plan.'}
            >
              <Button size="sm" onClick={onSave} disabled={!canSave || saving} aria-busy={saving}>
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                {saveLabel}
              </Button>
            </HoverExplain>
          )}
        </div>
      </div>
    </div>
  )
}
