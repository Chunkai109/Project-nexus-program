import { useMemo, useState } from 'react'
import { BarChart3, Dumbbell, Pencil, Plus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { formatRelativeTime } from '@/lib/formatRelativeTime'
import { presetUsage } from '@/lib/planCompare'
import type { Exercise } from '@/types'
import { bodyRegionLabel, plural } from './physioModel'
import { PageHeader } from './ui/PageHeader'
import { SearchBox } from './ui/SearchBox'
import { EmptyState, Skeleton } from './ui/States'

/** The grey tag for settings that are stored but not used by live sessions yet. */
function notUsedLine(p: Exercise): string | null {
  const threshold = p.angleConfigs.length > 0
  const muscles = p.muscleEmgTargets.length > 0
  if (threshold && muscles) return 'Fault threshold and muscle targets not used in sessions yet'
  if (threshold) return 'Fault threshold not used in sessions yet'
  if (muscles) return 'Muscle targets not used in sessions yet'
  return null
}

function PresetCard({ preset, used, onView, onEdit, readOnly }: { preset: Exercise; used: number; onView: () => void; onEdit: () => void; readOnly: boolean }) {
  const range = preset.angleConfigs[0]
  const tag = notUsedLine(preset)
  return (
    <Card className="flex h-full flex-col p-5">
      <h2 className="truncate text-[16px] font-semibold text-ink" title={preset.title}>
        {preset.title}
      </h2>
      <p className="text-[13px] text-ink-muted">{bodyRegionLabel(preset.bodyRegion)}</p>
      <ul className="mt-3 flex flex-col gap-1 text-[14px] text-ink">
        <li>
          {preset.sets} sets × {preset.reps} reps · about {preset.estMinutes} min
        </li>
        <li>{range ? `Target range ${range.targetMin}–${range.targetMax}°` : <span className="text-ink-muted">No target range set</span>}</li>
        <li>Drift limit {preset.driftToleranceDeg}°</li>
      </ul>
      <p className="mt-3 text-[14px] font-medium text-ink">{used === 0 ? 'Not used yet' : `Used by ${plural(used, 'patient')}`}</p>
      <p className="text-[13px] text-ink-muted">Edited {formatRelativeTime(preset.updatedAt)}</p>
      {tag && <p className="mt-3 self-start rounded-full bg-surface-secondary px-2.5 py-1 text-[13px] text-ink-muted">{tag}</p>}
      <div className="mt-auto flex flex-wrap gap-2 pt-4">
        <Button variant="secondary" onClick={onView} aria-label={`View results for ${preset.title}`}>
          <BarChart3 className="h-4 w-4" aria-hidden />
          View results
        </Button>
        {!readOnly && (
          <Button variant="outline" onClick={onEdit} aria-label={`Edit preset ${preset.title}`}>
            <Pencil className="h-4 w-4" aria-hidden />
            Edit preset
          </Button>
        )}
      </div>
    </Card>
  )
}

/** Exercise Creator: the physio's presets. Pure view, used by the real page and the demo. */
export function PresetListView({
  exercises,
  loading = false,
  onNew,
  onView,
  onEdit,
  readOnlyNote,
}: {
  /** Every exercise (presets and patient plans); usage is counted from the plans. */
  exercises: Exercise[]
  loading?: boolean
  onNew?: () => void
  onView: (id: string) => void
  onEdit: (id: string) => void
  /** Set in the demo: actions that would change data are hidden and this line explains why. */
  readOnlyNote?: string
}) {
  const [query, setQuery] = useState('')
  const presets = useMemo(() => exercises.filter((e) => e.assignedPatientId === null).sort((a, b) => b.updatedAt - a.updatedAt), [exercises])
  const shown = presets.filter((p) => p.title.toLowerCase().includes(query.trim().toLowerCase()))
  const newButton = onNew && (
    <Button onClick={onNew}>
      <Plus className="h-4 w-4" aria-hidden />
      New preset
    </Button>
  )

  return (
    <>
      <PageHeader
        title="Exercise Creator"
        subtitle="Presets are your starting points. Tailor them for each patient from the patient's Exercise plan tab."
        actions={newButton}
      />
      {readOnlyNote && <p className="-mt-4 mb-6 text-[14px] text-ink-muted">{readOnlyNote}</p>}
      {loading ? (
        <div aria-busy="true" aria-label="Loading presets…" className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-64 rounded-2xl" />
          ))}
        </div>
      ) : presets.length === 0 ? (
        <EmptyState icon={Dumbbell} message="No presets yet. Create your first preset to start building patient plans." action={newButton} />
      ) : (
        <>
          <SearchBox value={query} onChange={setQuery} label="Search presets" className="mb-4 w-full sm:w-72" />
          {shown.length === 0 ? (
            <p className="rounded-2xl bg-surface-secondary p-6 text-center text-[15px] text-ink">No preset matches that search.</p>
          ) : (
            <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {shown.map((p) => (
                <li key={p.id}>
                  <PresetCard preset={p} used={presetUsage(p.id, exercises)} onView={() => onView(p.id)} onEdit={() => onEdit(p.id)} readOnly={!!readOnlyNote} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  )
}
