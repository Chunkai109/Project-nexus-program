import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, CheckCircle2, CircleSlash, ExternalLink, Loader2, Vibrate } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { useAuth } from '@/lib/AuthContext'
import { useSensorHub } from '@/lib/hub/HubProvider'
import { CURL_DRIFT_POD_ID, CURL_FLEX_POD_ID, POD_HAPTIC_FORM } from '@/lib/hub/bicepCurlCounter'
import { DEFAULT_VISION_MODEL_URL } from '@/lib/visionModel'

type Check = { state: 'idle' } | { state: 'checking' } | { state: 'ok'; detail: string } | { state: 'fail'; detail: string }

function Status({ tone, children }: { tone: 'ok' | 'off' | 'fail' | 'busy'; children: React.ReactNode }) {
  const Icon = tone === 'ok' ? CheckCircle2 : tone === 'fail' ? AlertCircle : tone === 'busy' ? Loader2 : CircleSlash
  const colour = tone === 'ok' ? 'text-emerald-ink' : tone === 'fail' ? 'text-crimson-ink' : 'text-ink-muted'
  return (
    <span className={`inline-flex items-center gap-1.5 font-semibold ${colour}`}>
      <Icon className={`h-4 w-4 flex-shrink-0 ${tone === 'busy' ? 'animate-spin' : ''}`} aria-hidden />
      {children}
    </span>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-border py-2.5 last:border-0">
      <dt className="text-[15px] text-ink-muted">{label}</dt>
      <dd className="text-[16px] text-ink">{children}</dd>
    </div>
  )
}

const deg = (v: number | undefined) => (v === undefined ? 'No reading yet' : `${v.toFixed(1)}°`)

/**
 * Team-only checks for setting up a demo: is the hub talking, is the AI
 * server up, which data mode is the app in, and quick links to the demo
 * screens. Nothing here reads or changes patient records.
 */
export function DeveloperTools() {
  const { realAccounts } = useAuth()
  const hub = useSensorHub()
  const [ai, setAi] = useState<Check>({ state: 'idle' })
  const [buzz, setBuzz] = useState<Check>({ state: 'idle' })
  const connected = hub.connectionState === 'connected'

  async function checkAi() {
    setAi({ state: 'checking' })
    try {
      const res = await fetch(`${DEFAULT_VISION_MODEL_URL}/health`, { signal: AbortSignal.timeout(4000) })
      if (!res.ok) throw new Error(`The server answered with error ${res.status}.`)
      setAi({ state: 'ok', detail: JSON.stringify(await res.json()) })
    } catch (e) {
      setAi({ state: 'fail', detail: e instanceof Error && e.message.startsWith('The server') ? e.message : `Nothing answered at ${DEFAULT_VISION_MODEL_URL}. Start the AI server and try again.` })
    }
  }

  async function testBuzz() {
    setBuzz({ state: 'checking' })
    try {
      await hub.sendHaptic(POD_HAPTIC_FORM, 300)
      setBuzz({ state: 'ok', detail: 'Buzz command sent (300 ms). Check the motor moved.' })
    } catch {
      setBuzz({ state: 'fail', detail: "The hub didn't accept the buzz command." })
    }
  }

  const flex = hub.pods[CURL_FLEX_POD_ID]
  const drift = hub.pods[CURL_DRIFT_POD_ID]
  const emg = hub.pods[1]

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <Card className="p-6">
        <h2 className="text-[19px] font-bold text-ink">Hub and sensors</h2>
        <p className="mt-1 text-[15px] text-ink-muted">Join the SmartPhysio-Hub WiFi network first. That network has no internet.</p>
        <dl className="mt-3">
          <Row label="Hub">
            {connected ? <Status tone="ok">Connected</Status> : hub.connectionState === 'connecting' ? <Status tone="busy">Connecting…</Status> : hub.connectionState === 'error' ? <Status tone="fail">Connection failed</Status> : <Status tone="off">Not connected</Status>}
          </Row>
          <Row label="Pod 2, forearm angle">{connected ? deg(flex?.pitchDeg) : 'Hub not connected'}</Row>
          <Row label="Pod 3, upper-arm angle">{connected ? deg(drift?.pitchDeg) : 'Hub not connected'}</Row>
          <Row label="Reps counted by the hub data">{connected ? hub.curl.repCount : 'Hub not connected'}</Row>
          <Row label="Pod 1, muscle sensor (0–1 envelope)">
            {connected ? (emg?.vrmsRaw === undefined ? 'No reading yet' : emg.vrmsRaw.toFixed(4)) : 'Hub not connected'}
            <span className="block text-[14px] text-ink-muted">Filtered sEMG envelope ÷ EMG_FULL_SCALE_RMS in the hub sketch. Patient screens use it once the patient does the muscle effort step.</span>
          </Row>
        </dl>
        {hub.errorMessage && (
          <p role="alert" className="mt-3 flex items-start gap-2 text-[15px] font-medium text-crimson-ink">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
            {hub.errorMessage}
          </p>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {connected ? (
            <Button variant="secondary" size="sm" className="min-h-[40px] text-[15px]" onClick={() => hub.disconnect()}>
              Disconnect hub
            </Button>
          ) : (
            <Button size="sm" className="min-h-[40px] text-[15px]" disabled={hub.connectionState === 'connecting' || !hub.supported} onClick={() => void hub.connect().catch(() => {})}>
              Connect hub
            </Button>
          )}
          <Button variant="secondary" size="sm" className="min-h-[40px] text-[15px]" disabled={!connected || buzz.state === 'checking'} onClick={() => void testBuzz()}>
            <Vibrate className="h-4 w-4" aria-hidden />
            Test the buzz
          </Button>
        </div>
        <p className="mt-2 min-h-[1.5em] text-[15px]" aria-live="polite">
          {buzz.state === 'ok' && <Status tone="ok">{buzz.detail}</Status>}
          {buzz.state === 'fail' && <Status tone="fail">{buzz.detail}</Status>}
        </p>
      </Card>

      <div className="flex flex-col gap-5">
        <Card className="p-6">
          <h2 className="text-[19px] font-bold text-ink">AI server and data</h2>
          <dl className="mt-3">
            <Row label="AI form check server">
              {ai.state === 'idle' && <Status tone="off">Not checked yet</Status>}
              {ai.state === 'checking' && <Status tone="busy">Checking…</Status>}
              {ai.state === 'ok' && <Status tone="ok">Running</Status>}
              {ai.state === 'fail' && <Status tone="fail">Not reachable</Status>}
            </Row>
            <Row label="Accounts and records">{realAccounts ? <Status tone="ok">Real accounts (Supabase)</Status> : <Status tone="off">Local demo mode</Status>}</Row>
            <Row label="App build">{import.meta.env.DEV ? 'Development' : 'Release'}</Row>
          </dl>
          {(ai.state === 'ok' || ai.state === 'fail') && <p className="mt-2 break-words text-[14px] text-ink-muted">{ai.detail}</p>}
          <Button variant="secondary" size="sm" className="mt-4 min-h-[40px] text-[15px]" disabled={ai.state === 'checking'} onClick={() => void checkAi()}>
            Check AI server
          </Button>
        </Card>

        <Card className="p-6">
          <h2 className="text-[19px] font-bold text-ink">Demo and check screens</h2>
          <p className="mt-1 text-[15px] text-ink-muted">These use scripted demo data. They save nothing and do not use the hub.</p>
          <ul className="mt-3 flex flex-col gap-2 text-[16px]">
            {[
              ['/demo/patient/exercises', 'Patient screens, with demo data'],
              ['/demo/patient/live', 'Live session, scripted'],
              ['/demo/body', '3D body model check'],
              ['/demo/body?mode=setup&pods=1', '3D pod positions'],
            ].map(([to, label]) => (
              <li key={to}>
                <Link to={to} className="inline-flex items-center gap-2 font-semibold text-accent underline">
                  <ExternalLink className="h-4 w-4" aria-hidden />
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  )
}
