import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { TriangleAlert, Vibrate, Timer, Repeat } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { Logo } from '@/components/layout/Logo'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { GlassCard } from '@/components/ui/GlassCard'
import { Button } from '@/components/ui/Button'
import { RadialGauge } from '@/components/charts/RadialGauge'
import { EmgActivationBar } from '@/components/charts/EmgActivationBar'
import { CameraViewport } from '@/components/pose/CameraViewport'
import { PoseOverlay } from '@/components/pose/PoseOverlay'
import { BodyMap } from '@/components/body/BodyMap'
import { useSensorStream } from '@/lib/useSensorStream'
import { EXERCISES, PODS } from '@/lib/mockData'

export function LiveSession() {
  const { exerciseId } = useParams()
  const navigate = useNavigate()
  const exercise = useMemo(() => EXERCISES.find((e) => e.id === exerciseId) ?? EXERCISES[0], [exerciseId])
  const [ending, setEnding] = useState(false)

  const metrics = useSensorStream(!ending, exercise)
  const squatDepth = Math.max(0, Math.min(1, 1 - (metrics.kneeFlexionDeg - 70) / 60))

  function handleEnd() {
    setEnding(true)
    setTimeout(() => navigate('/patient/exercises'), 900)
  }

  const mm = String(Math.floor(metrics.elapsedSec / 60)).padStart(2, '0')
  const ss = String(metrics.elapsedSec % 60).padStart(2, '0')

  return (
    <PageShell>
      <header className="flex items-center justify-between border-b border-border px-8 py-5">
        <Logo size="sm" />
        <Breadcrumb
          steps={[{ label: 'Step 1: Sensor Placement' }, { label: 'Step 2: Calibration' }, { label: 'Step 3: Live Session' }]}
          activeIndex={2}
        />
        <div className="flex items-center gap-4 text-sm text-ink-muted">
          <span className="flex items-center gap-1.5">
            <Timer className="h-4 w-4 text-electric" />
            {mm}:{ss}
          </span>
          <span className="flex items-center gap-1.5">
            <Repeat className="h-4 w-4 text-electric" />
            {metrics.repCount} reps
          </span>
        </div>
      </header>

      <main className="grid grid-cols-1 gap-6 px-8 py-8 lg:grid-cols-[1.5fr_1fr]">
        {/* Primary viewport */}
        <div className="flex flex-col gap-4">
          <CameraViewport>
            <PoseOverlay squatDepth={squatDepth} faultActive={metrics.faultActive} faultDeg={metrics.faultDeg} />

            {metrics.faultActive && metrics.faultLabel && (
              <div className="animate-pulse-ring-crimson absolute bottom-4 left-4 flex items-center gap-2 rounded-lg border border-crimson/40 bg-crimson/15 px-3 py-2 text-xs font-semibold text-crimson backdrop-blur-sm">
                <TriangleAlert className="h-4 w-4" />
                {metrics.faultLabel}
              </div>
            )}

            <div className="absolute right-4 top-4 rounded-full bg-black/50 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
              {exercise.title}
            </div>
          </CameraViewport>

          <GlassCard className="p-4">
            <p className="text-xs text-ink-faint">
              Vision measures global joint angles from the camera feed; wearable pods add localized limb rotation the
              camera alone can't see, per the hybrid multimodal decision engine.
            </p>
          </GlassCard>
        </div>

        {/* Secondary column */}
        <div className="flex flex-col gap-5">
          <GlassCard className="flex flex-col items-center p-5">
            <RadialGauge
              value={metrics.kneeFlexionDeg}
              min={40}
              max={150}
              targetMin={metrics.targetMin}
              targetMax={metrics.targetMax}
              label="Knee Flexion Angle"
              fault={metrics.faultActive}
            />
          </GlassCard>

          <GlassCard className="flex flex-col gap-4 p-5">
            <h3 className="text-sm font-semibold text-ink">EMG Activation</h3>
            <EmgActivationBar label="Left Quad" value={metrics.emgLeft} target={exercise.targetEmgMvc} />
            <EmgActivationBar label="Right Quad" value={metrics.emgRight} target={exercise.targetEmgMvc} />
          </GlassCard>

          <GlassCard className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink">Haptic Biofeedback</h3>
              {metrics.activeHapticPod && (
                <span className="flex items-center gap-1.5 text-xs font-semibold text-crimson">
                  <Vibrate className="h-3.5 w-3.5" />
                  Pod {metrics.activeHapticPod} Active
                </span>
              )}
            </div>
            <div>
              <BodyMap pods={PODS} hapticPodId={metrics.activeHapticPod} height={170} />
            </div>
            <p className="mt-2 text-center text-xs text-ink-muted">
              {metrics.activeHapticPod
                ? 'Vibrotactile Correction Active — realign right knee over ankle'
                : 'Form within target corridor — no correction needed'}
            </p>
          </GlassCard>

          <Button variant="danger" size="lg" className="w-full" onClick={handleEnd} disabled={ending}>
            {ending ? 'Syncing session data…' : 'End Session & Sync Data'}
          </Button>
        </div>
      </main>
    </PageShell>
  )
}
