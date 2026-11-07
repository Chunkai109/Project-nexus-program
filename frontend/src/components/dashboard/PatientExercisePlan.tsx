import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Pencil, Plus, Trash2 } from 'lucide-react'
import { clsx } from 'clsx'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { ExerciseFormFields } from './ExerciseFormFields'
import { NotUsedYetTag } from './PlanTags'
import { useAppData } from '@/lib/data/AppDataContext'
import { formFromExercise, useExerciseForm, type ExerciseFormState } from '@/lib/useExerciseForm'
import { changesLabel, compareRows, countChanges } from '@/lib/planCompare'
import { sessionStats } from '@/lib/sessionStats'
import { formatRelativeTime } from '@/lib/formatRelativeTime'
import type { Exercise, PatientRecord } from '@/types'

type View = { kind: 'summary' } | { kind: 'edit'; planId: string } | { kind: 'new'; presetId: string }

/** The form fields that make up a saved plan, as text, to tell whether the editor has unsaved changes. */
function formSignature(f: ExerciseFormState): string {
  return JSON.stringify([
    f.title.trim(),
    f.muscleGroups,
    f.sets,
    f.reps,
    f.muscleEmgTargets,
    f.therapistNote,
    f.setupInstructions,
    f.estMinutes,
    f.angleConfigs,
    f.driftToleranceInput.trim(),
  ])
}

const SAVE_ERROR = "Couldn't save. Your changes are still here, try again."

/**
 * The patient's own exercise plans: each a personal copy of a preset that can
 * be tailored without changing the preset. Patients only ever see these.
 */
export function PatientExercisePlan({
  patient,
  onDirtyChange,
  onOpenCreator,
}: {
  patient: PatientRecord
  onDirtyChange: (dirty: boolean) => void
  onOpenCreator: () => void
}) {
  const { exercises, sessions, createPlanFromPreset, updateExercise, deleteExercise } = useAppData()

  const presets = useMemo(() => exercises.filter((e) => e.assignedPatientId === null), [exercises])
  const plans = useMemo(
    () => exercises.filter((e) => e.assignedPatientId === patient.id).sort((a, b) => b.createdAt - a.createdAt),
    [exercises, patient.id],
  )
  const patientSessions = useMemo(() => sessions.filter((s) => s.patientId === patient.id), [sessions, patient.id])
  const presetOf = (plan: Exercise) => presets.find((p) => p.id === plan.basedOnPresetId) ?? null

  // Default: the plan with the most recent session, else the newest plan.
  const defaultPlanId = useMemo(() => {
    const latest = [...patientSessions]
      .sort((a, b) => b.completedAt - a.completedAt)
      .find((s) => plans.some((p) => p.id === s.exerciseId))
    return latest?.exerciseId ?? plans[0]?.id ?? null
  }, [patientSessions, plans])
  const [chosenId, setChosenId] = useState<string | null>(null)
  const selected = plans.find((p) => p.id === chosenId) ?? plans.find((p) => p.id === defaultPlanId) ?? null

  const [view, setView] = useState<View>({ kind: 'summary' })
  const [editorKey, setEditorKey] = useState(0)
  const [baseline, setBaseline] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [comparing, setComparing] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)

  const formCtl = useExerciseForm()
  const { form, resetForm, canSave, buildPayload } = formCtl
  const editing = view.kind !== 'summary'
  const dirty = editing && formSignature(form) !== baseline

  useEffect(() => {
    onDirtyChange(dirty)
  }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])

  /** Runs `action` now, or after "Discard unsaved changes?" if the editor has unsaved changes. */
  function guard(action: () => void) {
    if (dirty) setPendingAction(() => action)
    else action()
  }

  function openEditor(source: Exercise, next: View) {
    resetForm(source)
    setBaseline(formSignature(formFromExercise(source)))
    setSaveError(null)
    setEditorKey((k) => k + 1)
    setView(next)
  }

  function selectPlan(id: string) {
    guard(() => {
      setChosenId(id)
      setComparing(false)
      setView({ kind: 'summary' })
    })
  }

  function startFromPreset(preset: Exercise) {
    guard(() => openEditor(preset, { kind: 'new', presetId: preset.id }))
  }

  async function handleSave() {
    if (!canSave || saving) return
    setSaving(true)
    setSaveError(null)
    try {
      const payload = buildPayload()
      if (view.kind === 'new') {
        const plan = await createPlanFromPreset(view.presetId, patient.id, { ...payload, assignedPatientId: patient.id })
        setChosenId(plan.id)
      } else if (view.kind === 'edit') {
        await updateExercise(view.planId, { ...payload, assignedPatientId: patient.id })
      }
      setView({ kind: 'summary' })
    } catch {
      setSaveError(SAVE_ERROR)
    } finally {
      setSaving(false)
    }
  }

  function handleRemove() {
    if (!selected) return
    deleteExercise(selected.id)
    setConfirmRemove(false)
    setChosenId(null)
    setView({ kind: 'summary' })
  }

  const newFromPreset = view.kind === 'new' ? (presets.find((p) => p.id === view.presetId) ?? null) : null
  const editingPlan = view.kind === 'edit' ? (plans.find((p) => p.id === view.planId) ?? null) : null
  const editorPreset = newFromPreset ?? (editingPlan ? presetOf(editingPlan) : null)
  const highlightedId = view.kind === 'new' ? null : selected?.id

  const addMenu = <AddFromPresetMenu presets={presets} onPick={startFromPreset} onOpenCreator={onOpenCreator} />

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      {/* List: a column on wide screens, a row of chips below 1024px. */}
      <Card className="hidden p-5 lg:col-span-4 lg:block">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-[15px] font-semibold text-ink">Exercises ({plans.length})</p>
        </div>
        {plans.length === 0 ? (
          <p className="rounded-xl bg-surface-secondary p-4 text-center text-[13px] text-ink-muted">No exercises assigned yet.</p>
        ) : (
          <ul className="flex flex-col gap-1" aria-label={`${patient.name}'s exercises`}>
            {plans.map((plan) => {
              const isSel = plan.id === highlightedId
              const preset = presetOf(plan)
              const n = countChanges(plan, preset)
              const tail = !plan.basedOnPresetId || !preset ? 'own plan' : n === 0 ? 'as preset' : changesLabel(n)
              return (
                <li key={plan.id}>
                  <button
                    type="button"
                    onClick={() => selectPlan(plan.id)}
                    aria-current={isSel ? 'true' : undefined}
                    className={clsx(
                      'w-full rounded-r-lg border-l-[3px] px-3 py-2.5 text-left transition-colors duration-150',
                      isSel ? 'border-accent bg-accent/10' : 'border-transparent hover:bg-surface-secondary',
                    )}
                  >
                    <span className="block truncate text-[14px] font-semibold text-ink">{plan.title}</span>
                    <span className="block text-[12px] tabular-nums text-ink-muted">
                      {plan.sets}×{plan.reps} · {tail}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        <div className="mt-4">{addMenu}</div>
      </Card>

      <div className="flex flex-wrap items-center gap-2 lg:hidden" aria-label={`${patient.name}'s exercises`}>
        {plans.length === 0 && <span className="whitespace-nowrap text-[13px] text-ink-muted">No exercises assigned yet.</span>}
        {plans.map((plan) => (
          <button
            key={plan.id}
            type="button"
            onClick={() => selectPlan(plan.id)}
            aria-current={plan.id === highlightedId ? 'true' : undefined}
            className={clsx(
              'max-w-[220px] flex-shrink-0 truncate rounded-full px-3.5 py-1.5 text-[13px] font-medium',
              plan.id === highlightedId ? 'bg-accent/10 text-accent' : 'bg-surface-secondary text-ink-muted',
            )}
          >
            {plan.title}
          </button>
        ))}
        <div className="flex-shrink-0">{addMenu}</div>
      </div>

      <div className="lg:col-span-8">
        {editing ? (
          <Card className="p-7">
            <h2 className="mb-6 text-[15px] font-semibold text-ink">
              {view.kind === 'new' ? `New plan from '${newFromPreset?.title ?? 'preset'}'` : `Edit ${editingPlan?.title ?? 'plan'}`}
            </h2>
            <ExerciseFormFields
              key={editorKey}
              {...formCtl}
              mode="patientPlan"
              compareTo={editorPreset}
              saving={saving}
              saveError={saveError}
              onSave={handleSave}
              onCancel={() => setView({ kind: 'summary' })}
              saveLabel={`Save for ${patient.name}`}
            />
          </Card>
        ) : !selected ? (
          <Card className="flex flex-col items-center gap-4 p-14 text-center">
            <p className="max-w-xs text-[14px] text-ink-muted">Add an exercise from a preset to start this patient's plan</p>
            {addMenu}
          </Card>
        ) : (
          <PlanSummary
            plan={selected}
            preset={presetOf(selected)}
            patient={patient}
            comparing={comparing}
            onToggleCompare={() => setComparing((c) => !c)}
            onEdit={() => openEditor(selected, { kind: 'edit', planId: selected.id })}
            onRemove={() => setConfirmRemove(true)}
            sessions={patientSessions.filter((s) => s.exerciseId === selected.id)}
          />
        )}
      </div>

      <ConfirmDialog
        open={confirmRemove}
        message={`Remove ${selected?.title ?? 'this exercise'} from ${patient.name}? Past sessions stay in their history.`}
        cancelLabel="Cancel"
        confirmLabel="Remove"
        danger
        onCancel={() => setConfirmRemove(false)}
        onConfirm={handleRemove}
      />
      <ConfirmDialog
        open={pendingAction !== null}
        message="Discard unsaved changes?"
        cancelLabel="Keep editing"
        confirmLabel="Discard"
        danger
        onCancel={() => setPendingAction(null)}
        onConfirm={() => {
          const action = pendingAction
          setPendingAction(null)
          action?.()
        }}
      />
    </div>
  )
}

function AddFromPresetMenu({
  presets,
  onPick,
  onOpenCreator,
}: {
  presets: Exercise[]
  onPick: (preset: Exercise) => void
  onOpenCreator: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <Button size="sm" variant="secondary" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Plus className="h-3.5 w-3.5" />
        Add from preset
      </Button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 z-30 mt-2 max-h-72 w-72 overflow-y-auto rounded-xl border border-border bg-surface p-1.5 shadow-[var(--shadow-ambient-lg)]"
        >
          {presets.length === 0 ? (
            <p className="p-3 text-[13px] text-ink-muted">
              No presets yet.{' '}
              <button
                type="button"
                className="font-medium text-accent underline-offset-2 hover:underline"
                onClick={() => {
                  setOpen(false)
                  onOpenCreator()
                }}
              >
                Create one in Exercise Creator
              </button>
            </p>
          ) : (
            presets.map((p) => (
              <button
                key={p.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  onPick(p)
                }}
                className="block w-full truncate rounded-lg px-3 py-2 text-left text-[13px] text-ink hover:bg-surface-secondary"
              >
                {p.title} <span className="tabular-nums text-ink-muted">· {p.sets}×{p.reps}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

function PlanSummary({
  plan,
  preset,
  patient,
  comparing,
  onToggleCompare,
  onEdit,
  onRemove,
  sessions,
}: {
  plan: Exercise
  preset: Exercise | null
  patient: PatientRecord
  comparing: boolean
  onToggleCompare: () => void
  onEdit: () => void
  onRemove: () => void
  sessions: ReturnType<typeof useAppData>['sessions']
}) {
  const rows = compareRows(plan, preset)
  const n = rows.filter((r) => r.differs).length
  const subtitle = preset
    ? `From preset '${preset.title}' · ${changesLabel(n)}`
    : plan.presetSnapshotAt !== null
      ? 'Own plan (preset was deleted)'
      : 'Own plan (no preset)'
  const presetUpdated = preset !== null && plan.presetSnapshotAt !== null && preset.updatedAt > plan.presetSnapshotAt
  const last = [...sessions].sort((a, b) => b.completedAt - a.completedAt)[0]
  const lastStats = last ? sessionStats(last) : null

  return (
    <Card className="p-7">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="break-words text-[15px] font-semibold text-ink">{plan.title}</h2>
          <p className="mt-0.5 text-[13px] text-ink-muted">{subtitle}</p>
        </div>
        <Button size="sm" variant="secondary" onClick={onEdit} aria-label={`Edit ${plan.title}`}>
          <Pencil className="h-3.5 w-3.5" />
          Edit
        </Button>
      </div>

      {presetUpdated && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-amber/10 px-4 py-3">
          <p className="flex items-center gap-2 text-[13px] font-medium text-amber">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" aria-hidden />
            Preset updated since this plan was made.
          </p>
          <Button size="sm" variant="outline" onClick={onToggleCompare} aria-pressed={comparing}>
            {comparing ? 'Hide comparison' : 'Compare'}
          </Button>
        </div>
      )}

      <table className="mt-6 w-full border-collapse text-[13px] tabular-nums">
        <thead>
          <tr className="border-b border-border text-left text-[12px] font-medium text-ink-muted">
            <th scope="col" className="py-2 pr-3 font-medium">
              Setting
            </th>
            <th scope="col" className="whitespace-nowrap py-2 pr-3 text-right font-medium">
              This patient
            </th>
            <th scope="col" className="py-2 text-right font-medium">
              Preset
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={clsx('border-b border-border last:border-b-0', comparing && r.differs && 'bg-amber/10')}>
              <th scope="row" className="py-2.5 pr-3 text-left font-normal text-ink-muted">
                <span className="inline-flex flex-wrap items-center gap-2">
                  {r.label}
                  {r.notUsedYet && <NotUsedYetTag />}
                </span>
              </th>
              <td className={clsx('whitespace-nowrap py-2.5 pr-3 text-right text-ink', r.differs && 'font-medium')}>
                {r.differs && (
                  <span className="mr-1.5 text-accent" aria-label="Changed from preset">
                    ●
                  </span>
                )}
                {r.plan}
              </td>
              <td className="whitespace-nowrap py-2.5 text-right text-[12px] text-ink-muted sm:text-[13px] sm:text-ink">{r.preset}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {preset && (
        <p className="mt-2 text-[12px] text-ink-muted">
          <span className="text-accent">●</span> Changed from preset
        </p>
      )}

      <div className="mt-6 rounded-xl bg-surface-secondary px-4 py-3 text-[13px]">
        {last && lastStats ? (
          <>
            <p className="font-medium text-ink">Last session with this plan · {formatRelativeTime(last.completedAt)}</p>
            <p className="mt-0.5 tabular-nums text-ink-muted">
              Good form {lastStats.goodFormPct === null ? '—' : `${lastStats.goodFormPct}%`} ({lastStats.unscored} of{' '}
              {lastStats.totalReps} not scored) · In range {lastStats.inRangePct === null ? '—' : `${lastStats.inRangePct}%`} · Drift faults{' '}
              {lastStats.driftFaults}
            </p>
          </>
        ) : (
          <p className="text-ink-muted">No sessions with this plan yet.</p>
        )}
      </div>

      <div className="mt-6 flex justify-end">
        <Button
          size="sm"
          variant="danger"
          className="!bg-transparent !text-crimson hover:!bg-crimson/10"
          onClick={onRemove}
          aria-label={`Remove ${plan.title} from ${patient.name}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Remove from patient
        </Button>
      </div>
    </Card>
  )
}
