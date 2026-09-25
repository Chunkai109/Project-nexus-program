import { useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { CheckCircle2, Timer, Repeat, Target, TriangleAlert, ArrowLeft, Crosshair, Gauge } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { Logo } from '@/components/layout/Logo'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { TrendChart } from '@/components/charts/TrendChart'
import { EmgActivationBar } from '@/components/charts/EmgActivationBar'
import { useAppData } from '@/lib/data/AppDataContext'
import { formatRelativeTime } from '@/lib/formatRelativeTime'
import type { SessionRecord, TelemetryPoint } from '@/types'

function average(values: number[]): number {
  return values.length === 0 ? 0 : Math.round(values.reduce((sum, v) => sum + v, 0) / values.length)
}

function romAdherencePctOf(s: SessionRecord): number {
  if (s.reps.length === 0) return 0
  const inCorridor = s.reps.filter((r) => r.angle >= s.targetMin && r.angle <= s.targetMax).length
  return Math.round((inCorridor / s.reps.length) * 100)
}

/** Green when the metric is good, amber when borderline, crimson otherwise. `direction: 'high'` means higher is better. */
function toneClass(pct: number, direction: 'high' | 'low'): string {
  const good = direction === 'high' ? pct >= 85 : pct <= 10
  const warn = direction === 'high' ? pct >= 60 : pct <= 25
  if (good) return 'text-emerald'
  if (warn) return 'text-amber'
  return 'text-crimson'
}

export function SessionSummary() {
  const { sessionId } = useParams()
  const navigate = useNavigate()
  const { sessions, exercises } = useAppData()
  const session = useMemo(() => sessions.find((s) => s.id === sessionId) ?? null, [sessions, sessionId])
  const exercise = useMemo(() => exercises.find((e) => e.id === session?.exerciseId) ?? null, [exercises, session])
  const targetEmgMvc = exercise?.targetEmgMvc ?? 70

  const priorSession = useMemo(() => {
    if (!session) return null
    return (
      sessions
        .filter(
          (s) => s.id !== session.id && s.patientId === session.patientId && s.exerciseId === session.exerciseId && s.completedAt < session.completedAt,
        )
        .sort((a, b) => b.completedAt - a.completedAt)[0] ?? null
    )
  }, [sessions, session])

  if (!session) {
    return (
      <PageShell>
        <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-10 text-center">
          <p className="text-[17px] font-semibold text-ink">Session not found</p>
          <p className="max-w-sm text-[14px] text-ink-faint">
            This session record may no longer be available. Head back to your exercise list to start a new one.
          </p>
          <Button onClick={() => navigate('/patient/exercises')}>
            <ArrowLeft className="h-4 w-4" />
            Back to Exercises
          </Button>
        </main>
      </PageShell>
    )
  }

  const trendData: TelemetryPoint[] = session.reps.map((r) => ({
    t: r.rep,
    angle: r.angle,
    targetMin: session.targetMin,
    targetMax: session.targetMax,
  }))

  const totalReps = session.reps.length
  const avgAngle = average(session.reps.map((r) => r.angle))
  const avgEmgLeft = average(session.reps.map((r) => r.emgLeft))
  const avgEmgRight = average(session.reps.map((r) => r.emgRight))
  const faultCount = session.reps.filter((r) => r.faultActive).length
  const mm = String(Math.floor(session.durationSec / 60)).padStart(2, '0')
  const ss = String(session.durationSec % 60).padStart(2, '0')

  const romAdherencePct = romAdherencePctOf(session)
  const faultRatePct = totalReps === 0 ? 0 : Math.round((faultCount / totalReps) * 100)
  const cadence = session.durationSec > 0 ? Math.round((totalReps / session.durationSec) * 60) : 0

  const priorRomAdherencePct = priorSession ? romAdherencePctOf(priorSession) : null
  const romAdherenceDelta = priorRomAdherencePct !== null ? romAdherencePct - priorRomAdherencePct : null

  return (
    <PageShell>
      <header className="translucent-header sticky top-0 z-20 flex items-center justify-between border-b border-border px-10 py-4">
        <Logo size="sm" />
        <div className="flex items-center gap-2 text-emerald">
          <CheckCircle2 className="h-4 w-4" />
          <span className="text-sm font-medium">Session Complete</span>
        </div>
        <ThemeToggle />
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-10 py-10">
        <Card className="p-7">
          <div className="mb-1 flex items-center justify-between">
            <h1 className="text-[19px] font-semibold text-ink">{session.exerciseTitle}</h1>
            <span className="text-[13px] text-ink-faint">{formatRelativeTime(session.completedAt)}</span>
          </div>
          <p className="text-[13px] text-ink-faint">
            {totalReps} rep{totalReps === 1 ? '' : 's'} recorded · Target corridor {session.targetMin}°–{session.targetMax}°
          </p>

          {romAdherenceDelta !== null ? (
            <p className="mt-1.5 text-[13px]">
              <span className={romAdherenceDelta >= 0 ? 'font-medium text-emerald' : 'font-medium text-crimson'}>
                {romAdherenceDelta >= 0 ? '▲' : '▼'} {Math.abs(romAdherenceDelta)}% Form Adherence
              </span>{' '}
              <span className="text-ink-faint">vs last session ({formatRelativeTime(priorSession!.completedAt)})</span>
            </p>
          ) : (
            <p className="mt-1.5 text-[13px] text-ink-faint">First recorded session for this exercise</p>
          )}

          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded-xl bg-surface-secondary p-4 text-center">
              <Repeat className="mx-auto mb-1.5 h-4 w-4 text-accent" />
              <p className="text-[19px] font-semibold text-ink">{totalReps}</p>
              <p className="text-[11px] text-ink-faint">Reps</p>
            </div>
            <div className="rounded-xl bg-surface-secondary p-4 text-center">
              <Timer className="mx-auto mb-1.5 h-4 w-4 text-accent" />
              <p className="text-[19px] font-semibold text-ink">
                {mm}:{ss}
              </p>
              <p className="text-[11px] text-ink-faint">Duration</p>
            </div>
            <div className="rounded-xl bg-surface-secondary p-4 text-center">
              <Target className="mx-auto mb-1.5 h-4 w-4 text-accent" />
              <p className="text-[19px] font-semibold text-ink">{avgAngle}°</p>
              <p className="text-[11px] text-ink-faint">Avg. Angle</p>
            </div>
            <div className="rounded-xl bg-surface-secondary p-4 text-center">
              <Crosshair className={`mx-auto mb-1.5 h-4 w-4 ${toneClass(romAdherencePct, 'high')}`} />
              <p className={`text-[19px] font-semibold ${toneClass(romAdherencePct, 'high')}`}>{romAdherencePct}%</p>
              <p className="text-[11px] text-ink-faint">Form Adherence</p>
            </div>
            <div className="rounded-xl bg-surface-secondary p-4 text-center">
              <TriangleAlert className={`mx-auto mb-1.5 h-4 w-4 ${toneClass(faultRatePct, 'low')}`} />
              <p className={`text-[19px] font-semibold ${toneClass(faultRatePct, 'low')}`}>{faultRatePct}%</p>
              <p className="text-[11px] text-ink-faint">Fault Rate ({faultCount}/{totalReps})</p>
            </div>
            <div className="rounded-xl bg-surface-secondary p-4 text-center">
              <Gauge className="mx-auto mb-1.5 h-4 w-4 text-accent" />
              <p className="text-[19px] font-semibold text-ink">{cadence}</p>
              <p className="text-[11px] text-ink-faint">Reps / Min</p>
            </div>
          </div>
        </Card>

        <Card className="p-7">
          <p className="mb-3 text-[13px] font-medium text-ink-muted">Joint Angle Trajectory</p>
          <TrendChart data={trendData} />
        </Card>

        <Card className="p-7">
          <p className="mb-4 text-[13px] font-medium text-ink-muted">Average Muscle Activation</p>
          <div className="flex flex-col gap-5">
            <EmgActivationBar label="Left Quad" value={avgEmgLeft} target={targetEmgMvc} />
            <EmgActivationBar label="Right Quad" value={avgEmgRight} target={targetEmgMvc} />
          </div>
        </Card>

        <Button size="lg" className="w-full" onClick={() => navigate('/patient/exercises')}>
          Back to Exercises
        </Button>
      </main>
    </PageShell>
  )
}
