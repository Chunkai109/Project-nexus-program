/**
 * Best-effort Web Bluetooth bridge to a real SmartPhysio ESP32 hub.
 * The GATT service/characteristic UUIDs below are placeholders pending
 * ESP32 firmware finalization — swap them in once the device advertises
 * its real service. Falls back to null so callers can keep driving the
 * UI from the local simulator when no device/browser support exists.
 */
export const SMARTPHYSIO_SERVICE_UUID = '0000fe40-cc7a-482a-984a-7f2ed5b3e58f'

export function isWebBluetoothSupported(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator
}

export async function requestSmartPhysioHub(): Promise<BluetoothDevice | null> {
  if (!isWebBluetoothSupported()) return null
  try {
    const device = await navigator.bluetooth!.requestDevice({
      filters: [{ namePrefix: 'SmartPhysio' }],
      optionalServices: [SMARTPHYSIO_SERVICE_UUID],
    })
    return device
  } catch {
    return null
  }
}
