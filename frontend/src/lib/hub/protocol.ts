/**
 * SmartPhysio WebSocket hub protocol — v1
 * =========================================
 *
 * JSON message contract between the web app and the ESP32 hub firmware
 * (see firmware/smartphysio_hub). The ESP32 hosts its own WiFi access point
 * plus a WebSocket server on port 81; the browser connects to it directly —
 * no router, internet, or relay server involved.
 *
 * This replaces the earlier BLE GATT binary protocol now that payload size
 * is no longer constrained by BLE's ~20-byte ATT limit, but keeps the same
 * field semantics (podId, pitch/roll/yaw, normalized EMG amplitude,
 * battery/signal, haptic duration) so the rest of the app barely notices
 * the swap.
 */

export type { PodId } from '@/types'
import type { PodId } from '@/types'

/** Default gateway IP of an ESP32 SoftAP, on the firmware's WebSocket port. */
export const DEFAULT_HUB_WS_URL = 'ws://192.168.4.1:81'

// ---------------------------------------------------------------------------
// hub -> app
// ---------------------------------------------------------------------------

/** Fused per-pod orientation, already run through the on-chip filter (MPU6050_light's complementary filter). */
export interface ImuPacket {
  podId: PodId
  pitchDeg: number
  rollDeg: number
  yawDeg: number
}

/**
 * Raw RMS muscle activation per pod, normalized to the pod's ADC full-scale
 * range (0.0-1.0) so the app applies the baseline/MVC calibration rather
 * than the firmware needing to know calibration state:
 *   %Activation = (Vrms - Vbaseline) / (Vmvc - Vbaseline) * 100
 */
export interface EmgPacket {
  podId: PodId
  vrmsNormalized: number
}

export type SignalLevel = 'offline' | 'weak' | 'strong'

export interface PodStatusPacket {
  podId: PodId
  batteryPct: number
  signal: SignalLevel
}

export interface HelloPacket {
  device: string
}

export type HubInboundMessage =
  | ({ type: 'imu' } & ImuPacket)
  | ({ type: 'emg' } & EmgPacket)
  | ({ type: 'status' } & PodStatusPacket)
  | ({ type: 'hello' } & HelloPacket)

const SIGNAL_LEVELS: SignalLevel[] = ['offline', 'weak', 'strong']

/** Parses one JSON text frame from the hub. Returns null for anything malformed or unrecognized rather than throwing. */
export function parseHubMessage(raw: string): HubInboundMessage | null {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof json !== 'object' || json === null || !('type' in json)) return null
  const msg = json as Record<string, unknown>

  switch (msg.type) {
    case 'imu':
      if (typeof msg.podId !== 'number') return null
      return {
        type: 'imu',
        podId: msg.podId as PodId,
        pitchDeg: Number(msg.pitch ?? 0),
        rollDeg: Number(msg.roll ?? 0),
        yawDeg: Number(msg.yaw ?? 0),
      }
    case 'emg':
      if (typeof msg.podId !== 'number') return null
      return {
        type: 'emg',
        podId: msg.podId as PodId,
        vrmsNormalized: Number(msg.vrms ?? 0),
      }
    case 'status': {
      if (typeof msg.podId !== 'number') return null
      const signal = typeof msg.signal === 'string' && (SIGNAL_LEVELS as string[]).includes(msg.signal)
        ? (msg.signal as SignalLevel)
        : 'offline'
      return {
        type: 'status',
        podId: msg.podId as PodId,
        batteryPct: Number(msg.battery ?? 0),
        signal,
      }
    }
    case 'hello':
      return { type: 'hello', device: typeof msg.device === 'string' ? msg.device : 'SmartPhysio Hub' }
    default:
      return null
  }
}

/** Default calibration until the Step 2 calibration flow captures per-patient values. */
export const DEFAULT_EMG_CALIBRATION = { baseline: 0.08, mvc: 1.0 }

export function emgActivationPercent(
  vrmsNormalized: number,
  calibration: { baseline: number; mvc: number } = DEFAULT_EMG_CALIBRATION,
): number {
  const { baseline, mvc } = calibration
  const pct = ((vrmsNormalized - baseline) / (mvc - baseline)) * 100
  return Math.max(0, Math.min(100, pct))
}

// ---------------------------------------------------------------------------
// app -> hub
// ---------------------------------------------------------------------------

export function encodeHapticCommand(podId: PodId, durationMs: number): string {
  return JSON.stringify({
    type: 'haptic',
    podId,
    durationMs: Math.max(0, Math.min(65535, Math.round(durationMs))),
  })
}
