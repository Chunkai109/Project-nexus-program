import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Info, LineChart } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { formatRelativeTime } from '@/lib/formatRelativeTime'
import { PLACEHOLDER_RULES } from '@/lib/dashboardRules'
import type { Exercise, PatientRecord, SessionRecord } from '@/types'
import { Initial } from './RosterView'
import { plural, presetResults, RESULTS_WINDOW_DAYS } from './physioModel'
import { SectionCard } from './ui/SectionCard'
import { StatTile } from './ui/StatTile'
import { StatusPill } from './ui/StatusPill'
import { EmptyState } from './ui/States'

/**
 * Preset results: real numbers pooled from the sessions of patient plans
 * copied from this preset, over the last 30 days. Nothing here is seeded,
 * random or estimated. Tempo, tremor and left/right muscle balance are not
 * measured by the rig, so they are not shown.
 */
export function ExerciseOptimizationMetrics({
  exercise,
  exercises,
  patients,
  sessions,
  onOpenPatient,
  now: nowProp,
}: {
  exercise: Exercise
  exercises: Exercise[]
  patients: PatientRecord[]
  sessions: SessionRecord[]
  onOpenPatient: (patientId: string) => void
  now?: number
}) {
  const [mountedAt] = useState(() => Date.now())
  const now = nowProp ?? mountedAt
  const r = presetResults(exercise, exercises, patients, sessions, now)
  const window = `in the last ${RESULTS_WINDOW_DAYS} days`
  const trained = new Set(r.sessions.map((s) => s.patientId)).size
  const goodFormLabel = PLACEHOLDER_RULES.goodFormVerdicts.join(' or ')
  const bars = Object.entries(r.verdicts)
    .map(([verdict, count]) => ({ verdict, count }))
    .sort((a, b) => b.count - a.count || a.verdict.localeCompare(b.verdict))

  const note = (
    <p className="flex items-start gap-2 text-[14px] text-ink-muted">
      <Info className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
      Tempo, tremor and left/right muscle balance are not measured by the current rig. They will appear here when they are.
    </p>
  )

  return (
    <div className="flex flex-col gap-6">
      <p className="text-[15px] text-ink-muted">Results from the last {RESULTS_WINDOW_DAYS} days, for patients whose plan was copied from this preset.</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile label="Patients using it" value={String(r.patientsUsing)} change={<span className="text-ink-muted">{trained} trained {window}</span>} footnote="Patients with a plan copied from this preset" />
        <StatTile label="Sessions in the last 30 days" value={String(r.sessions.length)} change={<span className="text-ink-muted">From {plural(trained, 'patient')}</span>} footnote={`${plural(r.totalReps, 'rep')} recorded`} />
        <StatTile
          label="Average good form"
          value={r.goodFormPct === null ? '—' : `${r.goodFormPct}%`}
          change={<span className="text-ink-muted">{plural(r.unscored, 'rep')} not scored</span>}
          footnote={r.scored === 0 ? 'No reps scored yet' : `${r.goodForm} ${goodFormLabel} of ${r.scored} scored reps, pooled`}
        />
        <StatTile label="Average in range" value={r.inRangePct === null ? '—' : `${r.inRangePct}%`} change={<span className="text-ink-muted">{window}</span>} footnote={`${r.inRange} of ${plural(r.totalReps, 'rep')}, pooled`} />
        <StatTile
          label="Drift faults per session"
          value={r.driftPerSession === null ? '—' : String(r.driftPerSession)}
          change={<span className="text-ink-muted">{window}</span>}
          footnote={`${plural(r.driftFaults, 'drift fault')} across ${plural(r.sessions.length, 'session')}`}
        />
      </div>

      {r.sessions.length === 0 ? (
        <EmptyState icon={LineChart} message="No sessions with this preset yet. Assign it to a patient from their Exercise plan tab." />
      ) : (
        <SectionCard title="AI verdicts across all sessions" subtitle={r.verdictTakeaway}>
          {r.scored === 0 ? (
            <p className="rounded-xl bg-surface-secondary p-6 text-center text-[14px] text-ink-muted">The AI has not scored any reps on this preset yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={bars} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 8 }}>
                <CartesianGrid stroke="var(--color-border)" horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={{ fill: 'var(--color-ink-muted)', fontSize: 12 }} axisLine={{ stroke: 'var(--color-border-strong)' }} tickLine={false} />
                <YAxis type="category" dataKey="verdict" width={92} tick={{ fill: 'var(--color-ink)', fontSize: 13 }} axisLine={false} tickLine={false} />
                <Tooltip
                  cursor={{ fill: 'var(--color-surface-secondary)' }}
                  contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, fontSize: 13, color: 'var(--color-ink)' }}
                  formatter={(value) => [`${value} reps`, 'AI verdict']}
                />
                <Bar dataKey="count" radius={[0, 6, 6, 0]} isAnimationActive={false}>
                  {bars.map((d) => (
                    <Cell key={d.verdict} fill={PLACEHOLDER_RULES.goodFormVerdicts.includes(d.verdict) ? 'var(--color-emerald)' : 'var(--color-ink-faint)'} />
                  ))}
                  <LabelList dataKey="count" position="right" fill="var(--color-ink)" fontSize={13} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
          <p className="mt-3 text-[13px] text-ink-muted">
            {r.unscored === 0 ? 'Every rep was scored.' : `${plural(r.unscored, 'rep was', 'reps were')} not scored and ${r.unscored === 1 ? 'is' : 'are'} left out of the bars.`}
          </p>
        </SectionCard>
      )}

      <SectionCard title="Patients on this preset" subtitle={r.patients.length === 0 ? 'No patient has a plan from this preset yet' : `${plural(r.patients.length, 'patient')}, whoever needs you most first`}>
        {r.patients.length > 0 && (
          <table className="w-full table-fixed border-separate border-spacing-0">
            <caption className="sr-only">Patients with a plan copied from this preset. Press Enter on a row to open that patient.</caption>
            <thead>
              <tr className="text-left text-[13px] text-ink-muted">
                <th scope="col" className="w-[34%] border-b border-border py-2 pr-3 font-semibold">Patient</th>
                <th scope="col" className="w-[30%] border-b border-border px-3 py-2 font-semibold">Status</th>
                <th scope="col" className="border-b border-border px-3 py-2 font-semibold">Last session</th>
                <th scope="col" className="border-b border-border px-3 py-2 font-semibold">Good form</th>
              </tr>
            </thead>
            <tbody>
              {r.patients.map((row) => (
                <tr
                  key={row.patient.id}
                  tabIndex={0}
                  aria-label={`Open ${row.patient.name}'s page`}
                  onClick={() => onOpenPatient(row.patient.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onOpenPatient(row.patient.id)
                    }
                  }}
                  className="cursor-pointer text-[14px] hover:bg-surface-secondary focus-visible:bg-surface-secondary [&:last-child>td]:border-b-0"
                >
                  <td className="border-b border-border py-3 pr-3">
                    <span className="flex min-w-0 items-center gap-3">
                      <Initial name={row.patient.name} />
                      <span className="truncate font-semibold text-ink" title={row.patient.name}>
                        {row.patient.name}
                      </span>
                    </span>
                  </td>
                  <td className="border-b border-border px-3 py-3">
                    <StatusPill status={row.status} reason={row.reason} />
                  </td>
                  <td className="border-b border-border px-3 py-3 text-ink">{row.lastSession ? formatRelativeTime(row.lastSession.session.completedAt) : <span className="text-ink-muted">No sessions yet</span>}</td>
                  <td className="border-b border-border px-3 py-3 tabular-nums">
                    {row.lastSession?.goodFormPct == null ? (
                      <span className="text-ink-muted">—</span>
                    ) : (
                      <>
                        <span className="font-semibold text-ink">{row.lastSession.goodFormPct}%</span>
                        <span className="block text-[13px] text-ink-muted">{row.lastSession.unscored} not scored</span>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>

      <Card className="p-5">{note}</Card>
    </div>
  )
}
