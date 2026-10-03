import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CircleCheck, Loader2, TriangleAlert, Vibrate, Wifi, WifiOff, Zap } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { Logo } from '@/components/layout/Logo'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { SensorPlacementPicker } from '@/components/body/SensorPlacementPicker'
import { PODS } from '@/lib/mockData'
import { useAppData } from '@/lib/data/AppDataContext'
import { podLabel } from '@/lib/podUtils'
import { useSensorHub } from '@/lib/hub/HubProvider'
import { DEFAULT_HUB_WS_URL, type PodId } from '@/lib/hub/protocol'
import type { Pod } from '@/types'
import { POD_HAPTIC_FORM } from '@/lib/hub/bicepCurlCounter'
import { clsx } from 'clsx'

const PLACEMENT_STEPS = [
  {
    title: 'Prep the skin',
    detail: 'Wipe the bicep and elbow electrode sites with an alcohol swab and let them air-dry for 10 seconds to reduce impedance noise.',
  },
  {
    title: 'Place the 3-lead EMG electrode (Pod 1)',
    detail: 'Stick the red and green electrodes on the belly of the bicep, 2cm apart along the muscle fiber direction — this pair carries Pod 1\'s signal. Stick the yellow reference electrode on the elbow, over bone rather than muscle, to give the sensor a clean electrical ground.',
  },
  {
    title: 'Strap the IMU pod on your forearm (Pod 2)',
    detail: 'Secure Pod 2 on the outer middle of the forearm, between the flexor and extensor muscle groups — this placement is the same whichever arm you use.',
  },
  {
    title: 'Strap the second IMU pod on your lower tricep (Pod 3)',
    detail: 'Secure Pod 3 on the lower tricep, close to the elbow. Together with Pod 2 this tracks forearm flexion against upper-arm drift.',
  },
  {
    title: 'Attach the vibration motor',
    detail: 'Motor 1 straps anywhere on the bicep part of the arm. It pulses only when a rep lands with correct form — not on entering the target corridor or on a detected fault. Only 3 sensor pods and 1 motor go on the arm in total.',
  },
  {
    title: 'Confirm connection',
    detail: 'Check the pod list on the left — every pod and motor should read a green "Signal Strong" badge before proceeding.',
  },
]

const signalTone: Record<string, { icon: typeof CircleCheck; text: string; className: string }> = {
  strong: { icon: CircleCheck, text: 'Signal Strong', className: 'text-emerald' },
  weak: { icon: TriangleAlert, text: 'Signal Weak', className: 'text-amber' },
  offline: { icon: TriangleAlert, text: 'Offline', className: 'text-crimson' },
}

export function SensorSetup() {
  const { exerciseId } = useParams()
  const navigate = useNavigate()
  const { exercises } = useAppData()
  const exercise = exercises.find((e) => e.id === exerciseId)
  const [activePod, setActivePod] = useState<number | null>(null)
  const [vibrating, setVibrating] = useState(false)
  const [hapticSendError, setHapticSendError] = useState<string | null>(null)
  const [hubUrl, setHubUrl] = useState(DEFAULT_HUB_WS_URL)
  const hub = useSensorHub()
  const hubConnected = hub.connectionState === 'connected'

  // Pod wiring metadata (label/location/kind) always comes from the known
  // hardware layout — only signal/battery are live, and only once a real
  // hub is actually connected. Before that (or for any sensor pod that
  // hasn't reported in yet), it reads "offline" rather than the PODS
  // array's placeholder values, so the badges never claim a signal that
  // hasn't actually been seen.
  //
  // The motor is the one exception: it's a plain GPIO output wired directly
  // to the same board, not a separate device with its own status report, so
  // there's no real "is the motor itself online" signal to wait for beyond
  // "is the hub online" -- hardcoded to strong/100 the instant hubConnected
  // is true, rather than depending on the firmware actually broadcasting a
  // status message for it (which needs the current .ino re-flashed to work
  // at all, and still wouldn't mean anything a GPIO pin can't already tell
  // you).
  const displayPods: Pod[] = PODS.map((pod) =>
    pod.id === (POD_HAPTIC_FORM as number)
      ? { ...pod, signal: hubConnected ? ('strong' as const) : ('offline' as const), battery: hubConnected ? 100 : 0 }
      : {
          ...pod,
          signal: hubConnected ? (hub.pods[pod.id as PodId]?.signal ?? 'offline') : 'offline',
          battery: hubConnected ? (hub.pods[pod.id as PodId]?.battery ?? 0) : 0,
        },
  )

  const allConnected = displayPods.every((p) => p.signal !== 'offline')

  async function testVibration() {
    setHapticSendError(null)
    if (hubConnected) {
      try {
        await hub.sendHaptic(POD_HAPTIC_FORM as PodId, 400)
      } catch (err) {
        setHapticSendError(err instanceof Error ? err.message : 'Failed to trigger vibration.')
      }
      return
    }
    setVibrating(true)
    setTimeout(() => setVibrating(false), 1600)
  }

  if (!exercise) {
    return (
      <PageShell>
        <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
          <p className="text-[17px] font-semibold text-ink">Exercise not found</p>
          <p className="max-w-sm text-[14px] text-ink-faint">
            This protocol may have been removed by your physiotherapist. Head back to your exercise list to see what's currently assigned.
          </p>
          <Button onClick={() => navigate('/patient/exercises')}>
            <ArrowLeft className="h-4 w-4" />
            Back to Exercises
          </Button>
        </main>
      </PageShell>
    )
  }

  return (
    <PageShell>
      <header className="translucent-header sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-6 lg:px-10 lg:py-4">
        <Logo size="sm" />
        <Breadcrumb
          steps={[{ label: 'Step 1: Sensor Placement' }, { label: 'Step 2: Calibration' }, { label: 'Step 3: Live Session' }]}
          activeIndex={0}
        />
        <ThemeToggle />
      </header>

      <main className="grid grid-cols-1 gap-6 px-4 py-6 sm:px-6 sm:py-8 lg:grid-cols-[380px_1fr] lg:px-10 lg:py-10">
        {/* Left column: body map + pod status */}
        <Card className="flex flex-col items-center p-7">
          <h2 className="mb-1 self-start text-[15px] font-semibold text-ink">Satellite Pod Map</h2>
          <p className="mb-5 self-start text-[13px] text-ink-faint">{exercise.title} · drag to rotate, tap a pod for details</p>
          <div className={clsx('w-full', vibrating && 'animate-pulse')}>
            <SensorPlacementPicker pods={displayPods} activePodId={activePod} onSelect={setActivePod} height={280} />
          </div>
          <p className="mb-1 text-center text-[12px] text-ink-faint">
            Highlighted nodes:{' '}
            {exercise.angleConfigs.length > 0
              ? exercise.angleConfigs.map((c) => `${podLabel(c.nodeA)} ↔ ${podLabel(c.nodeB)}`).join(' · ')
              : 'None configured'}
          </p>

          <div className="mt-5 flex w-full flex-col gap-2">
            {displayPods.map((pod) => {
              const tone = signalTone[pod.signal]
              const Icon = tone.icon
              return (
                <button
                  key={pod.id}
                  onClick={() => setActivePod(pod.id)}
                  className={clsx(
                    'flex items-start justify-between gap-3 rounded-xl px-3.5 py-2.5 text-left text-[13px] transition-colors duration-200',
                    activePod === pod.id ? 'bg-accent/8 ring-1 ring-accent/30' : 'bg-surface-secondary hover:bg-surface-hover',
                  )}
                >
                  <span className="flex min-w-0 items-start gap-2">
                    <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-surface text-[10px] font-semibold text-ink">
                      {pod.id}
                    </span>
                    {/* Label + location wrap freely onto their own lines as needed — the badge on the right is flex-shrink-0 + whitespace-nowrap so it's never the thing squeezed into wrapping. */}
                    <span className="min-w-0">
                      <span className="font-medium text-ink">{pod.label}</span>{' '}
                      <span className="text-ink-faint">· {pod.location}</span>
                    </span>
                  </span>
                  <span className={clsx('flex flex-shrink-0 items-center gap-1 whitespace-nowrap font-semibold', tone.className)}>
                    <Icon className="h-3.5 w-3.5" />
                    {tone.text}
                  </span>
                </button>
              )
            })}
          </div>
        </Card>

        {/* Right column: instructions */}
        <div className="flex flex-col gap-6">
          <Card className="p-7">
            <h2 className="mb-1 text-[15px] font-semibold text-ink">Pod Placement Instructions</h2>
            <p className="mb-6 text-[13px] text-ink-faint">
              Follow each step in order.
              {exercise.setupInstructions && <> Setup note from your physiotherapist: "{exercise.setupInstructions}"</>}
            </p>

            <ol className="flex flex-col gap-5">
              {PLACEMENT_STEPS.map((step, i) => (
                <li key={step.title} className="flex gap-4">
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-accent/10 text-sm font-semibold text-accent">
                    {i + 1}
                  </div>
                  <div>
                    <p className="text-[14px] font-medium text-ink">{step.title}</p>
                    <p className="mt-0.5 text-[13px] leading-relaxed text-ink-muted">{step.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>

          <Card className="flex flex-col gap-5 p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div
                  className={clsx(
                    'flex h-10 w-10 items-center justify-center rounded-full',
                    hubConnected ? 'bg-emerald/10' : hub.connectionState === 'error' ? 'bg-crimson/10' : 'bg-accent/10',
                  )}
                >
                  {hub.connectionState === 'connecting' ? (
                    <Loader2 className="h-5 w-5 animate-spin text-accent" />
                  ) : !hub.supported ? (
                    <WifiOff className="h-5 w-5 text-ink-faint" />
                  ) : (
                    <Wifi className={clsx('h-5 w-5', hubConnected ? 'text-emerald' : 'text-accent')} />
                  )}
                </div>
                <div className="text-sm">
                  <p className="font-semibold text-ink">
                    {!hub.supported && 'WebSockets unavailable'}
                    {hub.supported && hub.connectionState === 'disconnected' && 'No ESP32 hub connected'}
                    {hub.connectionState === 'connecting' && 'Connecting…'}
                    {hub.connectionState === 'connected' && `Connected — ${hub.deviceName}`}
                    {hub.connectionState === 'error' && 'Connection failed'}
                  </p>
                  <p className="text-[13px] text-ink-faint">
                    {!hub.supported
                      ? 'This browser has no WebSocket support — try a modern desktop or mobile browser.'
                      : hub.connectionState === 'error'
                        ? hub.errorMessage
                        : hubConnected
                          ? 'Live WebSocket stream active'
                          : 'Using simulated demo data until a real hub is connected'}
                  </p>
                </div>
              </div>
              {hub.supported && (
                <Button
                  variant={hubConnected ? 'outline' : 'secondary'}
                  size="sm"
                  onClick={() => (hubConnected ? hub.disconnect() : hub.connect(hubUrl).catch(() => {}))}
                  disabled={hub.connectionState === 'connecting'}
                >
                  {hubConnected ? 'Disconnect' : 'Connect ESP32 Hub'}
                </Button>
              )}
            </div>

            {hub.supported && !hubConnected && (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="hub-ws-url" className="text-[12px] font-medium text-ink-faint">
                  ESP32 hub address — join its WiFi network first, then connect here
                </label>
                <input
                  id="hub-ws-url"
                  type="text"
                  value={hubUrl}
                  onChange={(e) => setHubUrl(e.target.value)}
                  disabled={hub.connectionState === 'connecting'}
                  placeholder={DEFAULT_HUB_WS_URL}
                  className="rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-ink outline-none transition-colors focus:border-accent disabled:opacity-60"
                />
              </div>
            )}

            <div className="h-px bg-border" />

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm">
                <p className="font-semibold text-ink">
                  {allConnected ? 'All pods & motor connected' : 'Waiting for full pod connection'}
                </p>
                <p className="text-[13px] text-ink-faint">
                  ESP32-WROOM-32D hub · WebSocket stream {hubConnected ? '(live)' : '(simulated)'}
                </p>
                {hapticSendError && <p className="mt-1 text-[13px] text-crimson">{hapticSendError}</p>}
              </div>
              <div className="flex gap-3">
                <Button variant="secondary" onClick={testVibration}>
                  <Vibrate className="h-4 w-4" />
                  {vibrating ? 'Pulsing…' : 'Test Pod Vibration'}
                </Button>
                <Button onClick={() => navigate(`/patient/calibrate/${exercise.id}`)}>
                  <Zap className="h-4 w-4" />
                  Proceed to Calibration
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </main>
    </PageShell>
  )
}
