import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Activity, CalendarClock, Clock, Dumbbell, MessageSquareQuote, Target } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { PatientTopNav } from '@/components/layout/PatientTopNav'
import { PatientNavTabs } from '@/components/layout/PatientNavTabs'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { useAppData } from '@/lib/data/AppDataContext'
import { useAuth } from '@/lib/AuthContext'

export function PatientExercises() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { exercises, patients } = useAppData()
  const myPatientId = patients.find((p) => p.email === user?.email)?.id
  const visibleExercises = useMemo(
    () => exercises.filter((ex) => ex.assignedPatientId == null || ex.assignedPatientId === myPatientId),
    [exercises, myPatientId],
  )

  return (
    <PageShell>
      <PatientTopNav weeklyDone={3} weeklyTotal={4} battery={92} hubConnected />

      <main className="px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-12">
        <PatientNavTabs />

        <div className="mb-10 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[28px] font-semibold tracking-tight text-ink">Prescribed Exercises</h1>
            <p className="mt-1.5 text-[15px] text-ink-muted">
              {visibleExercises.length === 0
                ? 'Your physiotherapist hasn\'t published any protocols yet.'
                : `Your physiotherapist has assigned ${visibleExercises.length} protocol${visibleExercises.length === 1 ? '' : 's'} for this week.`}
            </p>
          </div>
          <Badge tone="accent" icon={<Activity className="h-3.5 w-3.5" />}>
            Live sensor sync ready
          </Badge>
        </div>

        {visibleExercises.length === 0 ? (
          <Card className="flex flex-col items-center gap-3 p-16 text-center">
            <CalendarClock className="h-8 w-8 text-ink-faint" />
            <p className="text-[15px] font-medium text-ink">No exercises assigned yet</p>
            <p className="max-w-sm text-[13px] text-ink-faint">
              Once your physiotherapist creates a protocol in their dashboard, it will appear here automatically.
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
            {visibleExercises.map((ex) => (
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
                    {ex.angleConfigs.length > 0
                      ? `${ex.angleConfigs[0].targetMin}°–${ex.angleConfigs[0].targetMax}° ROM`
                      : 'No ROM set'}
                    {ex.angleConfigs.length > 1 && ` (+${ex.angleConfigs.length - 1} more)`}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-accent" />
                    ~{ex.estMinutes} min
                  </div>
                </div>

                <div className="mb-7 flex flex-1 gap-2.5 rounded-xl bg-surface-secondary p-4">
                  <MessageSquareQuote className="mt-0.5 h-4 w-4 flex-shrink-0 text-ink-faint" />
                  <p className="text-[13px] leading-relaxed text-ink-muted">{ex.therapistNote || 'No note from your physiotherapist yet.'}</p>
                </div>

                <Button className="w-full" onClick={() => navigate(`/patient/setup/${ex.id}`)}>
                  Begin Session
                </Button>
              </Card>
            ))}
          </div>
        )}
      </main>
    </PageShell>
  )
}
