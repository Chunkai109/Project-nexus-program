import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { isWebSocketSupported, SmartPhysioSocketClient, type HubConnectionState } from './SmartPhysioSocketClient'
import { DEFAULT_HUB_WS_URL, emgActivationPercent, type PodId, type SignalLevel } from './protocol'

export interface PodLiveData {
  battery?: number
  signal?: SignalLevel
  pitchDeg?: number
  rollDeg?: number
  yawDeg?: number
  /** Raw normalized amplitude (0-1) straight off the hub's "emg" message, before baseline/MVC calibration is applied. */
  vrmsRaw?: number
  emgActivationPct?: number
}

export interface EmgCalibration {
  baseline: number
  mvc: number
}

interface HubValue {
  supported: boolean
  connectionState: HubConnectionState
  errorMessage: string | null
  deviceName: string | null
  pods: Partial<Record<PodId, PodLiveData>>
  calibration: Partial<Record<PodId, EmgCalibration>>
  connect: (url?: string) => Promise<void>
  disconnect: () => void
  sendHaptic: (podId: PodId, durationMs: number) => Promise<void>
  /** Sets the per-pod EMG baseline/MVC captured by the calibration routine; subsequent "emg" messages for that pod are normalized against it. */
  setCalibration: (podId: PodId, calibration: EmgCalibration) => void
}

const HubContext = createContext<HubValue | null>(null)

export function HubProvider({ children }: { children: ReactNode }) {
  const [connectionState, setConnectionState] = useState<HubConnectionState>('disconnected')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [deviceName, setDeviceName] = useState<string | null>(null)
  const [pods, setPods] = useState<Partial<Record<PodId, PodLiveData>>>({})
  const [calibration, setCalibrationState] = useState<Partial<Record<PodId, EmgCalibration>>>({})
  const clientRef = useRef<SmartPhysioSocketClient | null>(null)
  // The onEmg callback below is created once inside getClient, so it reads
  // calibration through this ref rather than the state closure to always see
  // the latest per-pod baseline/MVC without having to recreate the client.
  const calibrationRef = useRef<Partial<Record<PodId, EmgCalibration>>>({})

  const getClient = useCallback(() => {
    if (!clientRef.current) {
      clientRef.current = new SmartPhysioSocketClient({
        onConnectionChange: (state, detail) => {
          setConnectionState(state)
          setErrorMessage(state === 'error' ? (detail ?? 'Unknown error') : null)
          if (state === 'connected') setDeviceName(detail ?? 'SmartPhysio Hub')
          if (state === 'disconnected' || state === 'error') setPods({})
        },
        onImu: (packet) => {
          setPods((prev) => ({
            ...prev,
            [packet.podId]: {
              ...prev[packet.podId],
              pitchDeg: packet.pitchDeg,
              rollDeg: packet.rollDeg,
              yawDeg: packet.yawDeg,
            },
          }))
        },
        onEmg: (packet) => {
          setPods((prev) => ({
            ...prev,
            [packet.podId]: {
              ...prev[packet.podId],
              vrmsRaw: packet.vrmsNormalized,
              emgActivationPct: emgActivationPercent(packet.vrmsNormalized, calibrationRef.current[packet.podId]),
            },
          }))
        },
        onPodStatus: (packet) => {
          setPods((prev) => ({
            ...prev,
            [packet.podId]: { ...prev[packet.podId], battery: packet.batteryPct, signal: packet.signal },
          }))
        },
      })
    }
    return clientRef.current
  }, [])

  const connect = useCallback(
    async (url: string = DEFAULT_HUB_WS_URL) => {
      await getClient().connect(url)
    },
    [getClient],
  )

  const disconnect = useCallback(() => {
    clientRef.current?.disconnect()
  }, [])

  const sendHaptic = useCallback(
    async (podId: PodId, durationMs: number) => {
      await getClient().sendHaptic(podId, durationMs)
    },
    [getClient],
  )

  const setCalibration = useCallback((podId: PodId, calib: EmgCalibration) => {
    calibrationRef.current = { ...calibrationRef.current, [podId]: calib }
    setCalibrationState((prev) => ({ ...prev, [podId]: calib }))
  }, [])

  const value = useMemo<HubValue>(
    () => ({
      supported: isWebSocketSupported(),
      connectionState,
      errorMessage,
      deviceName,
      pods,
      calibration,
      connect,
      disconnect,
      sendHaptic,
      setCalibration,
    }),
    [connectionState, errorMessage, deviceName, pods, calibration, connect, disconnect, sendHaptic, setCalibration],
  )

  return <HubContext.Provider value={value}>{children}</HubContext.Provider>
}

export function useSensorHub(): HubValue {
  const ctx = useContext(HubContext)
  if (!ctx) throw new Error('useSensorHub must be used within HubProvider')
  return ctx
}
