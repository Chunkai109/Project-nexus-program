import { useNavigate } from 'react-router-dom'
import { Activity, Clock, Dumbbell, MessageSquareQuote, Target } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { PatientTopNav } from '@/components/layout/PatientTopNav'
import { GlassCard } from '@/components/ui/GlassCard'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EXERCISES } from '@/lib/mockData'

export function PatientExercises() {
  const navigate = useNavigate()

  return (
    <PageShell>
      <PatientTopNav weeklyDone={3} weeklyTotal={4} battery={92} bleConnected />

      <main className="px-8 py-8">
        <div className="mb-7 flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-bold text-ink">Prescribed Exercises</h1>
            <p className="mt-1 text-sm text-ink-muted">
              Your physiotherapist has assigned {EXERCISES.length} protocols for this week.
            </p>
          </div>
          <Badge tone="electric" icon={<Activity className="h-3.5 w-3.5" />}>
            Live sensor sync ready
          </Badge>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          {EXERCISES.map((ex) => (
            <GlassCard key={ex.id} className="flex flex-col p-6 transition-transform hover:-translate-y-0.5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <h2 className="text-lg font-semibold leading-snug text-ink">{ex.title}</h2>
                <Badge tone="violet" icon={<Dumbbell className="h-3 w-3" />}>
                  {ex.sets}×{ex.reps}
                </Badge>
              </div>

              <div className="mb-4 flex flex-wrap gap-1.5">
                {ex.muscleGroups.map((m) => (
                  <span key={m} className="rounded-full bg-white/5 px-2.5 py-1 text-[11px] font-medium text-ink-muted">
                    {m}
                  </span>
                ))}
              </div>

              <div className="mb-4 flex items-center gap-4 text-sm text-ink-muted">
                <div className="flex items-center gap-1.5">
                  <Target className="h-3.5 w-3.5 text-electric" />
                  {ex.targetRomMin}°–{ex.targetRomMax}° ROM
                </div>
                <div className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-electric" />
                  ~{ex.estMinutes} min
                </div>
              </div>

              <div className="mb-6 flex flex-1 gap-2 rounded-xl border border-border bg-white/[0.02] p-3">
                <MessageSquareQuote className="mt-0.5 h-4 w-4 flex-shrink-0 text-ink-faint" />
                <p className="text-xs leading-relaxed text-ink-muted">{ex.therapistNote}</p>
              </div>

              <Button className="w-full" onClick={() => navigate(`/patient/setup/${ex.id}`)}>
                Begin Session
              </Button>
            </GlassCard>
          ))}
        </div>
      </main>
    </PageShell>
  )
}
