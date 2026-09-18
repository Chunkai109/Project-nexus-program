import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { SmartPhysioBleClient, isWebBluetoothSupported, type BleConnectionState } from './SmartPhysioBleClient'
import { emgActivationPercent, type PodId, type SignalLevel } from './protocol'

export interface PodLiveData {
  battery?: number
  signal?: SignalLevel
  pitchDeg?: number
  rollDeg?: number
  yawDeg?: number
  emgActivationPct?: number
}

interface BleHubValue {
  supported: boolean
  connectionState: BleConnectionState
  errorMessage: string | null
  deviceName: string | null
  pods: Partial<Record<PodId, PodLiveData>>
  connect: () => Promise<void>
  disconnect: () => void
  sendHaptic: (podId: PodId, durationMs: number) => Promise<void>
}

const BleContext = createContext<BleHubValue | null>(null)

export function BleProvider({ children }: { children: ReactNode }) {
  const [connectionState, setConnectionState] = useState<BleConnectionState>('disconnected')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [deviceName, setDeviceName] = useState<string | null>(null)
  const [pods, setPods] = useState<Partial<Record<PodId, PodLiveData>>>({})
  const clientRef = useRef<SmartPhysioBleClient | null>(null)

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
            [packet.podId]: { ...prev[packet.podId], emgActivationPct: emgActivationPercent(packet.vrmsNormalized) },
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

  const value = useMemo<BleHubValue>(
    () => ({
      supported: isWebBluetoothSupported(),
      connectionState,
      errorMessage,
      deviceName,
      pods,
      connect,
      disconnect,
      sendHaptic,
    }),
    [connectionState, errorMessage, deviceName, pods, connect, disconnect, sendHaptic],
  )

  return <BleContext.Provider value={value}>{children}</BleContext.Provider>
}

export function useBleHub(): BleHubValue {
  const ctx = useContext(BleContext)
  if (!ctx) throw new Error('useBleHub must be used within BleProvider')
  return ctx
}
