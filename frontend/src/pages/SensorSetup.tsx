import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { Button } from '@/components/ui/Button'
import { SensorSetupView, type PodRow } from '@/components/patient/SensorSetupView'
import { PODS } from '@/lib/mockData'
import { useAppData } from '@/lib/data/AppDataContext'
import { useSensorHub } from '@/lib/hub/HubProvider'
import { DEFAULT_HUB_WS_URL, type PodId } from '@/lib/hub/protocol'
import { POD_HAPTIC_FORM } from '@/lib/hub/bicepCurlCounter'

/** Plain-language name and place for each pod on the curl rig. */
const POD_WORDS: Record<number, { name: string; place: string }> = {
  1: { name: 'Muscle sensor', place: 'On the bicep' },
  2: { name: 'Motion sensor', place: 'On the outer forearm' },
  3: { name: 'Motion sensor', place: 'Back of the upper arm, just above the elbow' },
  [POD_HAPTIC_FORM]: { name: 'Vibration motor', place: 'On the bicep' },
}

export function SensorSetup() {
  const { exerciseId } = useParams()
  const navigate = useNavigate()
  const { exercises } = useAppData()
  const exercise = exercises.find((e) => e.id === exerciseId)
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
  const rows: PodRow[] = PODS.map((pod) => {
    const words = POD_WORDS[pod.id] ?? { name: pod.kind, place: pod.location }
    if (pod.id === (POD_HAPTIC_FORM as number)) {
      return { pod, ...words, signal: hubConnected ? 'strong' : 'offline', battery: null, poweredByHub: true }
    }
    const live = hubConnected ? hub.pods[pod.id as PodId] : undefined
    return { pod, ...words, signal: live?.signal ?? 'offline', battery: live?.battery ?? null }
  })

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
      <PageShell fullWidth>
        <main className="flex min-h-app flex-col items-center justify-center gap-4 px-6 text-center">
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
    <PageShell fullWidth>
      <SensorSetupView
        exercise={exercise}
        rows={rows}
        hubState={hub.connectionState}
        hubSupported={hub.supported}
        hubError={hub.errorMessage}
        hubUrl={hubUrl}
        onHubUrlChange={setHubUrl}
        onConnect={() => hub.connect(hubUrl).catch(() => {})}
        onDisconnect={() => hub.disconnect()}
        onTestVibration={testVibration}
        vibrating={vibrating}
        vibrationError={hapticSendError}
        onContinue={() => navigate(`/patient/calibrate/${exercise.id}`)}
      />
    </PageShell>
  )
}
