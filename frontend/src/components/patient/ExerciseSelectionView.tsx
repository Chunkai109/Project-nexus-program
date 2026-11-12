import type { ReactNode } from 'react'
import { CalendarClock, CheckCircle2, Circle, Clock, MessageSquareQuote, Play, Target } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import type { Exercise, SessionRecord } from '@/types'
import { PatientContainer } from './PatientContainer'

export interface ExerciseToday {
  exercise: Exercise
  /** The session done today with this exercise, if any (the latest one). */
  doneToday: SessionRecord | null
}

function timeOfDay(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

/** "What has my physio given me today, and have I done it yet?" */
export function ExerciseSelectionView({
  header,
  tabs,
  items,
  onStart,
}: {
  header: ReactNode
  tabs?: ReactNode
  items: ExerciseToday[]
  onStart: (exerciseId: string) => void
}) {
  // Not-done first, so the next thing to do is at the top.
  const ordered = [...items].sort((a, b) => Number(!!a.doneToday) - Number(!!b.doneToday))
  const done = items.filter((i) => i.doneToday).length

  return (
    <>
      {header}
      <main>
        <PatientContainer className="py-6 sm:py-8 lg:py-10">
        {tabs}
        <div className="mb-8">
          <h1 className="text-[30px] font-bold tracking-tight text-ink">Today's exercises</h1>
          <p className="mt-1.5 text-[17px] text-ink-muted">
            {items.length === 0
              ? "Your physiotherapist hasn't assigned an exercise yet."
              : done === items.length
                ? `All done for today. ${items.length} of ${items.length} finished.`
                : `${done} of ${items.length} done today.`}
          </p>
        </div>

        {items.length === 0 ? (
          <Card className="flex flex-col items-center gap-3 p-14 text-center">
            <CalendarClock className="h-9 w-9 text-ink-faint" aria-hidden />
            <p className="text-[18px] font-semibold text-ink">No exercises assigned yet</p>
            <p className="max-w-sm text-[16px] text-ink-muted">
              Your physiotherapist hasn't assigned an exercise yet. It will appear here as soon as they do.
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-3">
            {ordered.map(({ exercise: ex, doneToday }) => (
              <Card key={ex.id} className="flex flex-col p-6 sm:p-7">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-[22px] font-bold leading-snug tracking-tight text-ink">{ex.title}</h2>
                  {doneToday ? (
                    <span className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full bg-emerald/10 px-3 py-1.5 text-[14px] font-semibold text-emerald-ink">
                      <CheckCircle2 className="h-4 w-4" aria-hidden />
                      Done today at {timeOfDay(doneToday.completedAt)}
                    </span>
                  ) : (
                    <span className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full bg-surface-secondary px-3 py-1.5 text-[14px] font-semibold text-ink-muted">
                      <Circle className="h-4 w-4" aria-hidden />
                      Not done yet
                    </span>
                  )}
                </div>

                <p className="mt-3 text-[18px] font-semibold text-ink">
                  {ex.sets} sets × {ex.reps} reps
                </p>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-[16px] text-ink-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="h-4 w-4 text-accent" aria-hidden />
                    About {ex.estMinutes} min
                  </span>
                  {ex.angleConfigs[0] && (
                    <span className="inline-flex items-center gap-1.5">
                      <Target className="h-4 w-4 text-accent" aria-hidden />
                      Target {ex.angleConfigs[0].targetMin}–{ex.angleConfigs[0].targetMax}°
                    </span>
                  )}
                </div>

                {ex.therapistNote && (
                  <div className="mt-4 flex gap-2.5 rounded-xl bg-surface-secondary p-4">
                    <MessageSquareQuote className="mt-0.5 h-5 w-5 flex-shrink-0 text-ink-faint" aria-hidden />
                    <p className="max-w-[60ch] text-[16px] leading-relaxed text-ink">
                      <span className="block text-[13px] font-semibold text-ink-muted">Note from your physiotherapist</span>
                      {ex.therapistNote}
                    </p>
                  </div>
                )}

                <div className="mt-auto pt-6">
                  <Button
                    size="lg"
                    variant={doneToday ? 'secondary' : 'primary'}
                    className="min-h-[52px] w-full text-[17px]"
                    onClick={() => onStart(ex.id)}
                  >
                    <Play className="h-5 w-5" aria-hidden />
                    {doneToday ? 'Do again' : 'Start'}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </PatientContainer>
      </main>
    </>
  )
}
