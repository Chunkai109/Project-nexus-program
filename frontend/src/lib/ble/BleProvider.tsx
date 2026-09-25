import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { SmartPhysioBleClient, isWebBluetoothSupported, type BleConnectionState } from './SmartPhysioBleClient'
import { emgActivationPercent, type PodId, type SignalLevel } from './protocol'

export interface PodLiveData {
  battery?: number
  signal?: SignalLevel
  pitchDeg?: number
  rollDeg?: number
  yawDeg?: number
  /** Raw normalized ADC amplitude (0-1) straight off the EMG_DATA characteristic, before baseline/MVC calibration is applied. */
  vrmsRaw?: number
  emgActivationPct?: number
}

export interface EmgCalibration {
  baseline: number
  mvc: number
}

interface BleHubValue {
  supported: boolean
  connectionState: BleConnectionState
  errorMessage: string | null
  deviceName: string | null
  pods: Partial<Record<PodId, PodLiveData>>
  calibration: Partial<Record<PodId, EmgCalibration>>
  connect: () => Promise<void>
  disconnect: () => void
  sendHaptic: (podId: PodId, durationMs: number) => Promise<void>
  /** Sets the per-pod EMG baseline/MVC captured by the calibration routine; subsequent EMG_DATA packets for that pod are normalized against it. */
  setCalibration: (podId: PodId, calibration: EmgCalibration) => void
}

const BleContext = createContext<BleHubValue | null>(null)

export function BleProvider({ children }: { children: ReactNode }) {
  const [connectionState, setConnectionState] = useState<BleConnectionState>('disconnected')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [deviceName, setDeviceName] = useState<string | null>(null)
  const [pods, setPods] = useState<Partial<Record<PodId, PodLiveData>>>({})
  const [calibration, setCalibrationState] = useState<Partial<Record<PodId, EmgCalibration>>>({})
  const clientRef = useRef<SmartPhysioBleClient | null>(null)
  // The onEmg callback below is created once inside getClient, so it reads
  // calibration through this ref rather than the state closure to always see
  // the latest per-pod baseline/MVC without having to recreate the client.
  const calibrationRef = useRef<Partial<Record<PodId, EmgCalibration>>>({})

  const getClient = useCallback(() => {
    if (!clientRef.current) {
      clientRef.current = new SmartPhysioBleClient({
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

  const connect = useCallback(async () => {
    await getClient().connect()
  }, [getClient])

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

  const value = useMemo<BleHubValue>(
    () => ({
      supported: isWebBluetoothSupported(),
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

  return <BleContext.Provider value={value}>{children}</BleContext.Provider>
}

export function useBleHub(): BleHubValue {
  const ctx = useContext(BleContext)
  if (!ctx) throw new Error('useBleHub must be used within BleProvider')
  return ctx
}
