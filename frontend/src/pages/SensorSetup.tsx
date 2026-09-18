import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Bluetooth, BluetoothOff, CircleCheck, Loader2, TriangleAlert, Vibrate, Zap } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { Logo } from '@/components/layout/Logo'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { BodyMap } from '@/components/body/BodyMap'
import { PODS, EXERCISES } from '@/lib/mockData'
import { useBleHub } from '@/lib/ble/BleProvider'
import type { PodId } from '@/lib/ble/protocol'
import { clsx } from 'clsx'

const PLACEMENT_STEPS = [
  {
    title: 'Prep the skin',
    detail: 'Wipe each electrode site with an alcohol swab and let it air-dry for 10 seconds to reduce impedance noise.',
  },
  {
    title: 'Place EMG electrodes (Pods 1–2)',
    detail: 'Snap Ag/AgCl electrodes onto Pod 1 & 2, aligned along the vastus medialis fiber direction, 2cm apart.',
  },
  {
    title: 'Secure knee IMU + haptics (Pods 3–4)',
    detail: 'Strap Pod 3 & 4 directly over the lateral knee joint line using the neoprene band — snug, not restrictive.',
  },
  {
    title: 'Attach shin/ankle pods (Pods 5–6)',
    detail: 'Position Pod 5 & 6 just above the malleolus. Leave slack in the ribbon cable for full range of motion.',
  },
  {
    title: 'Route the ribbon harness',
    detail: 'Run the 6-core silicone ribbon along the limb\'s lateral line, clipping with velcro every ~10cm to avoid pinch points.',
  },
  {
    title: 'Confirm connection',
    detail: 'Check the pod list on the left — every pod should read a green "Signal Strong" badge before proceeding.',
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
  const exercise = EXERCISES.find((e) => e.id === exerciseId) ?? EXERCISES[0]
  const [activePod, setActivePod] = useState<number | null>(null)
  const [vibrating, setVibrating] = useState(false)
  const [hapticSendError, setHapticSendError] = useState<string | null>(null)
  const hub = useBleHub()
  const hubConnected = hub.connectionState === 'connected'

  // While a real hub is connected, pod wiring metadata (label/location/kind)
  // still comes from the known hardware layout — only signal/battery are
  // live. Until a pod reports in, it reads "offline" rather than borrowing
  // the simulated demo numbers, so it's never ambiguous which is real.
  const displayPods = hubConnected
    ? PODS.map((pod) => ({
        ...pod,
        signal: hub.pods[pod.id as PodId]?.signal ?? 'offline',
        battery: hub.pods[pod.id as PodId]?.battery ?? 0,
      }))
    : PODS

  const allConnected = displayPods.every((p) => p.signal !== 'offline')

  async function testVibration() {
    setHapticSendError(null)
    if (hubConnected) {
      try {
        await Promise.all([hub.sendHaptic(3 as PodId, 400), hub.sendHaptic(4 as PodId, 400)])
      } catch (err) {
        setHapticSendError(err instanceof Error ? err.message : 'Failed to trigger vibration.')
      }
      return
    }
    setVibrating(true)
    setTimeout(() => setVibrating(false), 1600)
  }

  return (
    <PageShell>
      <header className="translucent-header sticky top-0 z-20 flex items-center justify-between border-b border-border px-10 py-4">
        <Logo size="sm" />
        <Breadcrumb
          steps={[{ label: 'Step 1: Sensor Placement' }, { label: 'Step 2: Calibration' }, { label: 'Step 3: Live Session' }]}
          activeIndex={0}
        />
        <ThemeToggle />
      </header>

      <main className="grid grid-cols-1 gap-6 px-10 py-10 lg:grid-cols-[380px_1fr]">
        {/* Left column: body map + pod status */}
        <Card className="flex flex-col items-center p-7">
          <h2 className="mb-1 self-start text-[15px] font-semibold text-ink">Satellite Pod Map</h2>
          <p className="mb-5 self-start text-[13px] text-ink-faint">{exercise.title} · tap a pod for details</p>
          <div className={clsx('py-2', vibrating && 'animate-pulse')}>
            <BodyMap pods={displayPods} activePod={activePod} onSelect={setActivePod} height={340} />
          </div>

          <div className="mt-5 flex w-full flex-col gap-2">
            {displayPods.map((pod) => {
              const tone = signalTone[pod.signal]
              const Icon = tone.icon
              return (
                <button
                  key={pod.id}
                  onClick={() => setActivePod(pod.id)}
                  className={clsx(
                    'flex items-center justify-between rounded-xl px-3.5 py-2.5 text-left text-[13px] transition-colors duration-200',
                    activePod === pod.id ? 'bg-accent/8 ring-1 ring-accent/30' : 'bg-surface-secondary hover:bg-surface-hover',
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-surface text-[10px] font-semibold text-ink">
                      {pod.id}
                    </span>
                    <span className="font-medium text-ink">{pod.label}</span>
                    <span className="text-ink-faint">· {pod.location}</span>
                  </span>
                  <span className={clsx('flex items-center gap-1 font-semibold', tone.className)}>
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
              Follow each step in order. Setup note from your physiotherapist: “{exercise.setupInstructions}”
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
                    <BluetoothOff className="h-5 w-5 text-ink-faint" />
                  ) : (
                    <Bluetooth className={clsx('h-5 w-5', hubConnected ? 'text-emerald' : 'text-accent')} />
                  )}
                </div>
                <div className="text-sm">
                  <p className="font-semibold text-ink">
                    {!hub.supported && 'Web Bluetooth unavailable'}
                    {hub.supported && hub.connectionState === 'disconnected' && 'No ESP32 hub connected'}
                    {hub.connectionState === 'connecting' && 'Connecting…'}
                    {hub.connectionState === 'connected' && `Connected — ${hub.deviceName}`}
                    {hub.connectionState === 'error' && 'Connection failed'}
                  </p>
                  <p className="text-[13px] text-ink-faint">
                    {!hub.supported
                      ? 'Try Chrome or Edge on desktop or Android to pair real hardware.'
                      : hub.connectionState === 'error'
                        ? hub.errorMessage
                        : hubConnected
                          ? 'Live BLE GATT stream active'
                          : 'Using simulated demo data until a real hub is paired'}
                  </p>
                </div>
              </div>
              {hub.supported && (
                <Button
                  variant={hubConnected ? 'outline' : 'secondary'}
                  size="sm"
                  onClick={() => (hubConnected ? hub.disconnect() : hub.connect().catch(() => {}))}
                  disabled={hub.connectionState === 'connecting'}
                >
                  {hubConnected ? 'Disconnect' : 'Connect ESP32 Hub'}
                </Button>
              )}
            </div>

            <div className="h-px bg-border" />

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm">
                <p className="font-semibold text-ink">
                  {allConnected ? 'All 6 pods connected' : 'Waiting for full pod connection'}
                </p>
                <p className="text-[13px] text-ink-faint">
                  ESP32-WROOM-32D hub · BLE GATT stream {hubConnected ? '(live)' : '(simulated)'}
                </p>
                {hapticSendError && <p className="mt-1 text-[13px] text-crimson">{hapticSendError}</p>}
              </div>
              <div className="flex gap-3">
                <Button variant="secondary" onClick={testVibration}>
                  <Vibrate className="h-4 w-4" />
                  {vibrating ? 'Pulsing…' : 'Test Pod Vibration'}
                </Button>
                <Button onClick={() => navigate(`/patient/session/${exercise.id}`)}>
                  <Zap className="h-4 w-4" />
                  Proceed to Camera Check
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </main>
    </PageShell>
  )
}
