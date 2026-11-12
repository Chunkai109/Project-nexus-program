import { useState } from 'react'
import { ArrowRight, BatteryLow, BatteryMedium, Loader2, Plug, Vibrate, Wifi, WifiOff } from 'lucide-react'
import { clsx } from 'clsx'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { SensorPlacementPicker } from '@/components/body/SensorPlacementPicker'
import { SessionHeader, type HubState } from './PatientHeader'
import { Details, StatusLabel, type StatusTone } from './PatientBits'
import type { Exercise, Pod } from '@/types'
import { PatientContainer } from './PatientContainer'

/** One row of the pod list. `battery` is null when the pod hasn't reported one. */
export interface PodRow {
  pod: Pod
  /** Plain-language name and place, e.g. "Muscle sensor" / "On the bicep". */
  name: string
  place: string
  signal: 'strong' | 'weak' | 'offline'
  battery: number | null
  /** The vibration motor is wired to the hub and has no battery of its own. */
  poweredByHub?: boolean
}

const SIGNAL: Record<PodRow['signal'], { tone: StatusTone; words: string }> = {
  strong: { tone: 'good', words: 'Connected' },
  weak: { tone: 'warning', words: 'Weak signal' },
  offline: { tone: 'fault', words: 'Not connected' },
}

const LOW_BATTERY_PCT = 20

const STEPS = [
  { title: 'Clean the skin', detail: 'Wipe your bicep and elbow with an alcohol swab and let it dry for 10 seconds.' },
  {
    title: 'Pod 1: muscle sensor on the bicep',
    detail: 'Stick the red and green pads on the middle of the bicep, 2 cm apart, in line with the arm. Stick the yellow pad on the bony part of the elbow.',
  },
  { title: 'Pod 2: motion sensor on the forearm', detail: 'Strap Pod 2 on the outer middle of your forearm.' },
  { title: 'Pod 3: motion sensor above the elbow', detail: 'Strap Pod 3 on the back of your upper arm, just above the elbow.' },
  { title: 'Motor 1: vibration motor on the bicep', detail: 'Strap it anywhere on the bicep. It gives a short buzz each time a rep is scored Perfect.' },
]

/** "Are all my pods on, charged and connected?" */
export function SensorSetupView({
  exercise,
  rows,
  hubState,
  hubSupported = true,
  hubError,
  hubUrl,
  onHubUrlChange,
  onConnect,
  onDisconnect,
  onTestVibration,
  vibrating,
  vibrationError,
  onContinue,
}: {
  exercise: Exercise
  rows: PodRow[]
  hubState: HubState
  hubSupported?: boolean
  hubError?: string | null
  hubUrl: string
  onHubUrlChange: (url: string) => void
  onConnect: () => void
  onDisconnect: () => void
  onTestVibration: () => void
  vibrating: boolean
  vibrationError?: string | null
  onContinue: () => void
}) {
  const [activePod, setActivePod] = useState<number | null>(null)
  const connected = rows.filter((r) => r.signal !== 'offline').length
  const allConnected = connected === rows.length
  const hubOn = hubState === 'connected'
  const lowBattery = rows.filter((r) => r.battery !== null && r.battery < LOW_BATTERY_PCT)

  return (
    <>
      <SessionHeader step={0} />
      <main>
        <PatientContainer className="grid grid-cols-1 gap-6 py-6 sm:py-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:py-10">
        <div className="lg:col-span-2">
          <p className="text-[15px] font-semibold text-ink-muted">{exercise.title}</p>
          <h1 className="text-[30px] font-bold tracking-tight text-ink">Put on your sensors</h1>
          <p className="mt-2 text-[20px]" aria-live="polite">
            {allConnected ? (
              <StatusLabel tone="good">All {rows.length} connected</StatusLabel>
            ) : (
              <StatusLabel tone={hubOn ? 'warning' : 'neutral'}>
                {connected} of {rows.length} connected
              </StatusLabel>
            )}
          </p>
        </div>

        {/* Left: connect + pod status */}
        <div className="flex flex-col gap-6">
          <Card className="p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span
                  className={clsx(
                    'flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full',
                    hubOn ? 'bg-emerald/10 text-emerald' : hubState === 'error' ? 'bg-crimson/10 text-crimson' : 'bg-accent/10 text-accent',
                  )}
                >
                  {hubState === 'connecting' ? (
                    <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
                  ) : hubOn ? (
                    <Wifi className="h-6 w-6" aria-hidden />
                  ) : (
                    <WifiOff className="h-6 w-6" aria-hidden />
                  )}
                </span>
                <div>
                  <h2 className="text-[19px] font-bold text-ink" aria-live="polite">
                    {hubOn && 'Hub connected'}
                    {hubState === 'connecting' && 'Connecting to the hub…'}
                    {hubState === 'disconnected' && 'Hub not connected'}
                    {hubState === 'error' && 'Hub not found'}
                  </h2>
                  <p className="text-[15px] text-ink-muted">WiFi network: SmartPhysio-Hub</p>
                </div>
              </div>
              {hubSupported && (
                <Button
                  size="lg"
                  variant={hubOn ? 'outline' : 'primary'}
                  className="min-h-[48px]"
                  onClick={hubOn ? onDisconnect : onConnect}
                  disabled={hubState === 'connecting'}
                >
                  <Plug className="h-5 w-5" aria-hidden />
                  {hubOn ? 'Disconnect' : 'Connect'}
                </Button>
              )}
            </div>

            {!hubOn && (
              <ol className="mt-4 flex flex-col gap-1.5 rounded-xl bg-surface-secondary p-4 text-[16px] text-ink">
                <li>1. Switch on the hub.</li>
                <li>
                  2. On this laptop, join the WiFi network <span className="font-semibold">SmartPhysio-Hub</span>.
                </li>
                <li>
                  3. Press <span className="font-semibold">Connect</span>.
                </li>
              </ol>
            )}
            {hubState === 'error' && (
              <p role="alert" className="mt-3 text-[15px] font-medium text-crimson-ink">
                Couldn't reach the hub. Check it is switched on and that this laptop has joined SmartPhysio-Hub, then try again.
                {hubError ? ` (${hubError})` : ''}
              </p>
            )}
            {!hubSupported && <p className="mt-3 text-[15px] text-crimson-ink">This browser can't connect to the hub. Try a current version of Chrome or Edge.</p>}
            {!hubOn && hubSupported && (
              <div className="mt-4">
                <Details summary="Advanced: hub address">
                  <label htmlFor="hub-ws-url" className="text-[14px]">
                    Only change this if your physiotherapist asks you to.
                  </label>
                  <input
                    id="hub-ws-url"
                    type="text"
                    value={hubUrl}
                    onChange={(e) => onHubUrlChange(e.target.value)}
                    disabled={hubState === 'connecting'}
                    className="rounded-lg border border-border-strong bg-surface px-3 py-2.5 text-[15px] text-ink disabled:opacity-60"
                  />
                </Details>
              </div>
            )}
          </Card>

          <Card className="p-6">
            <h2 className="mb-4 text-[19px] font-bold text-ink">Your 4 pods</h2>
            <ul className="flex flex-col gap-2.5">
              {rows.map((r) => {
                const sig = SIGNAL[r.signal]
                const low = r.battery !== null && r.battery < LOW_BATTERY_PCT
                return (
                  <li key={r.pod.id}>
                    <button
                      type="button"
                      onClick={() => setActivePod(r.pod.id)}
                      aria-pressed={activePod === r.pod.id}
                      className={clsx(
                        'grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 rounded-xl px-4 py-3 text-left transition-colors duration-200',
                        activePod === r.pod.id ? 'bg-accent/10 ring-1 ring-accent/40' : 'bg-surface-secondary hover:bg-surface-hover',
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block text-[17px] font-bold text-ink">
                          {r.pod.label} <span className="font-medium text-ink-muted">· {r.name}</span>
                        </span>
                        <span className="block text-[15px] text-ink-muted">{r.place}</span>
                      </span>
                      <span className="flex flex-col items-end gap-0.5 whitespace-nowrap text-[15px]">
                        <StatusLabel tone={sig.tone}>{sig.words}</StatusLabel>
                        <span className={clsx('inline-flex items-center gap-1', low ? 'font-semibold text-amber-ink' : 'text-ink-muted')}>
                          {r.poweredByHub ? (
                            'Powered by the hub'
                          ) : r.battery === null ? (
                            'Battery —'
                          ) : (
                            <>
                              {low ? <BatteryLow className="h-4 w-4" aria-hidden /> : <BatteryMedium className="h-4 w-4" aria-hidden />}
                              Battery {r.battery}%{low ? ' · charge soon' : ''}
                            </>
                          )}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
            {lowBattery.length > 0 && (
              <p className="mt-3 text-[15px] font-medium text-amber-ink">
                {lowBattery.map((r) => r.pod.label).join(' and ')} {lowBattery.length === 1 ? 'is' : 'are'} below {LOW_BATTERY_PCT}% battery. Charge
                before your next session.
              </p>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button variant="secondary" className="min-h-[48px] text-[16px]" onClick={onTestVibration}>
                <Vibrate className="h-5 w-5" aria-hidden />
                {vibrating ? 'Buzzing…' : 'Test the buzz'}
              </Button>
              {!hubOn && <span className="text-[14px] text-ink-muted">The motor only buzzes when the hub is connected.</span>}
            </div>
            {vibrationError && (
              <p role="alert" className="mt-2 text-[15px] text-crimson-ink">
                {vibrationError}
              </p>
            )}
          </Card>
        </div>

        {/* Right: where each pod goes */}
        <div className="flex flex-col gap-6">
          <Card className="p-6">
            <h2 className="mb-1 text-[19px] font-bold text-ink">Where each pod goes</h2>
            <p className="mb-3 text-[15px] text-ink-muted">Drag the figure to turn it. Tap a pod in the list to find it.</p>
            <div className={clsx(vibrating && 'animate-pulse')}>
              <SensorPlacementPicker pods={rows.map((r) => ({ ...r.pod, signal: r.signal, battery: r.battery ?? 0 }))} activePodId={activePod} onSelect={setActivePod} height={240} />
            </div>
            {exercise.setupInstructions && (
              <div className="mt-4 rounded-xl bg-accent/10 p-4">
                <p className="text-[13px] font-semibold text-ink-muted">Setup note from your physiotherapist</p>
                <p className="mt-0.5 whitespace-pre-line text-[16px] leading-relaxed text-ink">{exercise.setupInstructions}</p>
              </div>
            )}
            <ol className="mt-5 flex flex-col gap-4">
              {STEPS.map((step, i) => (
                <li key={step.title} className="flex gap-3.5">
                  <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-accent/10 text-[15px] font-bold text-accent">
                    {i + 1}
                  </span>
                  <div>
                    <p className="text-[17px] font-semibold text-ink">{step.title}</p>
                    <p className="mt-0.5 text-[16px] leading-relaxed text-ink-muted">{step.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-4 lg:col-span-2">
          {!allConnected && (
            <p className="text-[15px] text-ink-muted">
              {hubOn ? 'Some pods are not connected yet.' : 'Without the hub, the next screens use a simulated arm angle.'}
            </p>
          )}
          <Button size="lg" className="min-h-[52px] px-8 text-[17px]" variant={allConnected ? 'primary' : 'secondary'} onClick={onContinue}>
            {allConnected ? 'Next: check your arm' : 'Continue anyway'}
            <ArrowRight className="h-5 w-5" aria-hidden />
          </Button>
        </div>
      </PatientContainer>
      </main>
    </>
  )
}
