import { useNavigate } from 'react-router-dom'
import { Activity, Clock, Dumbbell, MessageSquareQuote, Target } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { PatientTopNav } from '@/components/layout/PatientTopNav'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EXERCISES } from '@/lib/mockData'

export function PatientExercises() {
  const navigate = useNavigate()

  return (
    <PageShell>
      <PatientTopNav weeklyDone={3} weeklyTotal={4} battery={92} bleConnected />

      <main className="px-10 py-12">
        <div className="mb-10 flex items-end justify-between">
          <div>
            <h1 className="text-[28px] font-semibold tracking-tight text-ink">Prescribed Exercises</h1>
            <p className="mt-1.5 text-[15px] text-ink-muted">
              Your physiotherapist has assigned {EXERCISES.length} protocols for this week.
            </p>
          </div>
          <Badge tone="accent" icon={<Activity className="h-3.5 w-3.5" />}>
            Live sensor sync ready
          </Badge>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          {EXERCISES.map((ex) => (
            <Card key={ex.id} className="flex flex-col p-7 transition-transform duration-200 hover:-translate-y-0.5">
              <div className="mb-5 flex items-start justify-between gap-3">
                <h2 className="text-[17px] font-semibold leading-snug tracking-tight text-ink">{ex.title}</h2>
                <Badge tone="violet" icon={<Dumbbell className="h-3 w-3" />}>
                  {ex.sets}×{ex.reps}
                </Badge>
              </div>

              <div className="mb-5 flex flex-wrap gap-1.5">
                {ex.muscleGroups.map((m) => (
                  <span key={m} className="rounded-full bg-surface-secondary px-2.5 py-1 text-[11px] font-medium text-ink-muted">
                    {m}
                  </span>
                ))}
              </div>

              <div className="mb-5 flex items-center gap-4 text-sm text-ink-muted">
                <div className="flex items-center gap-1.5">
                  <Target className="h-3.5 w-3.5 text-accent" />
                  {ex.targetRomMin}°–{ex.targetRomMax}° ROM
                </div>
                <div className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-accent" />
                  ~{ex.estMinutes} min
                </div>
              </div>

              <div className="mb-7 flex flex-1 gap-2.5 rounded-xl bg-surface-secondary p-4">
                <MessageSquareQuote className="mt-0.5 h-4 w-4 flex-shrink-0 text-ink-faint" />
                <p className="text-[13px] leading-relaxed text-ink-muted">{ex.therapistNote}</p>
              </div>

              <Button className="w-full" onClick={() => navigate(`/patient/setup/${ex.id}`)}>
                Begin Session
              </Button>
            </Card>
          ))}
        </div>
      </main>
    </PageShell>
  )
}
