/**
 * SmartPhysio BLE GATT protocol — draft v0.1
 * =============================================
 *
 * This is the contract the ESP32 hub firmware needs to implement for the
 * web app's real Web Bluetooth client (SmartPhysioBleClient) to talk to it.
 * No firmware exists yet, so nothing here has been validated against real
 * hardware — it's a concrete starting point derived from the proposal's
 * "Sensor Signal Processing & On-Chip Pipeline" section (complementary
 * filter IMU fusion done on-chip, EMG baseline/MVC calibration), sized to
 * fit comfortably inside a default 20-byte BLE ATT payload.
 *
 * One GATT primary service, four characteristics:
 *
 *   IMU_DATA      notify   7 bytes  fused per-pod orientation
 *   EMG_DATA      notify   3 bytes  per-pod raw muscle activation
 *   POD_STATUS    notify   3 bytes  per-pod battery + link quality
 *   HAPTIC_CONTROL write   3 bytes  app -> hub vibration command
 *
 * All multi-byte fields are little-endian, matching ESP32's native byte
 * order, so firmware can just memcpy a packed struct into the BLE buffer.
 */

export const SMARTPHYSIO_SERVICE_UUID = '0000fe40-cc7a-482a-984a-7f2ed5b3e58f'

export const CHARACTERISTIC_UUID = {
  IMU_DATA: '0000fe41-cc7a-482a-984a-7f2ed5b3e58f',
  EMG_DATA: '0000fe42-cc7a-482a-984a-7f2ed5b3e58f',
  POD_STATUS: '0000fe43-cc7a-482a-984a-7f2ed5b3e58f',
  HAPTIC_CONTROL: '0000fe44-cc7a-482a-984a-7f2ed5b3e58f',
} as const

export type PodId = 1 | 2 | 3 | 4 | 5 | 6

// ---------------------------------------------------------------------------
// IMU_DATA — notify, 7 bytes
// Fused orientation per satellite pod, already run through the on-chip
// complementary filter described in the proposal (raw accel/gyro never
// leaves the pod). Angles are hundredths of a degree so a single int16
// covers the full -180.00..180.00 range without a decimal point over BLE.
//
//   byte 0    podId          uint8   1-6
//   byte 1-2  pitch_centideg int16   LE, degrees * 100
//   byte 3-4  roll_centideg  int16   LE, degrees * 100
//   byte 5-6  yaw_centideg   int16   LE, degrees * 100
// ---------------------------------------------------------------------------
export interface ImuPacket {
  podId: PodId
  pitchDeg: number
  rollDeg: number
  yawDeg: number
}

export function decodeImuPacket(data: DataView): ImuPacket {
  return {
    podId: data.getUint8(0) as PodId,
    pitchDeg: data.getInt16(1, true) / 100,
    rollDeg: data.getInt16(3, true) / 100,
    yawDeg: data.getInt16(5, true) / 100,
  }
}

// ---------------------------------------------------------------------------
// EMG_DATA — notify, 3 bytes
// Raw RMS muscle activation per pod, normalized to the pod's ADC full-scale
// range (0.0-1.0) so the app applies the baseline/MVC calibration from the
// proposal's EMG normalization routine rather than the firmware needing to
// know calibration state:
//   %Activation = (Vrms - Vbaseline) / (Vmvc - Vbaseline) * 100
//
//   byte 0    podId              uint8   1-6
//   byte 1-2  vrms_normalized    uint16  LE, 0-65535 maps to 0.0-1.0
// ---------------------------------------------------------------------------
export interface EmgPacket {
  podId: PodId
  vrmsNormalized: number
}

export function decodeEmgPacket(data: DataView): EmgPacket {
  return {
    podId: data.getUint8(0) as PodId,
    vrmsNormalized: data.getUint16(1, true) / 65535,
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
// POD_STATUS — notify, 3 bytes
//   byte 0    podId          uint8   1-6
//   byte 1    batteryPct     uint8   0-100
//   byte 2    signal         uint8   0=offline, 1=weak, 2=strong
// ---------------------------------------------------------------------------
export type SignalLevel = 'offline' | 'weak' | 'strong'
const SIGNAL_LEVELS: SignalLevel[] = ['offline', 'weak', 'strong']

export interface PodStatusPacket {
  podId: PodId
  batteryPct: number
  signal: SignalLevel
}

export function decodePodStatusPacket(data: DataView): PodStatusPacket {
  return {
    podId: data.getUint8(0) as PodId,
    batteryPct: data.getUint8(1),
    signal: SIGNAL_LEVELS[data.getUint8(2)] ?? 'offline',
  }
}

// ---------------------------------------------------------------------------
// HAPTIC_CONTROL — write, 3 bytes (app -> hub)
//   byte 0    podId          uint8   1-6, must be a pod wired for haptics
//   byte 1-2  durationMs     uint16  LE, how long to drive the ERM motor
// ---------------------------------------------------------------------------
export function encodeHapticCommand(podId: PodId, durationMs: number): ArrayBuffer {
  const buf = new ArrayBuffer(3)
  const view = new DataView(buf)
  view.setUint8(0, podId)
  view.setUint16(1, Math.max(0, Math.min(65535, Math.round(durationMs))), true)
  return buf
}
