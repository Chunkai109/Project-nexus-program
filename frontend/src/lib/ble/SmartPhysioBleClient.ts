import {
  SMARTPHYSIO_SERVICE_UUID,
  CHARACTERISTIC_UUID,
  decodeImuPacket,
  decodeEmgPacket,
  decodePodStatusPacket,
  encodeHapticCommand,
  type ImuPacket,
  type EmgPacket,
  type PodStatusPacket,
  type PodId,
} from './protocol'

export type BleConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface SmartPhysioBleClientEvents {
  onImu?: (packet: ImuPacket) => void
  onEmg?: (packet: EmgPacket) => void
  onPodStatus?: (packet: PodStatusPacket) => void
  onConnectionChange?: (state: BleConnectionState, detail?: string) => void
}

export function isWebBluetoothSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.bluetooth
}

export function describeBleError(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === 'NotFoundError') return 'No device selected.'
    if (err.name === 'SecurityError') return 'Bluetooth access was blocked — this needs HTTPS and a direct user click.'
    if (err.name === 'NetworkError') return 'Lost connection to the device.'
    return err.message || err.name
  }
  if (err instanceof Error) return err.message
  return String(err)
}

/**
 * Real Web Bluetooth client for a SmartPhysio ESP32 hub, per the protocol
 * documented in ./protocol.ts. There's no physical hub to test this against
 * yet — every call here is genuine `navigator.bluetooth` API usage, not a
 * mock, but it has only been exercised against the chooser-cancel and
 * unsupported-browser paths. Firmware needs to advertise
 * SMARTPHYSIO_SERVICE_UUID with the four characteristics below before the
 * happy path can be verified end-to-end.
 */
export class SmartPhysioBleClient {
  private device: BluetoothDevice | null = null
  private server: BluetoothRemoteGATTServer | null = null
  private imuChar: BluetoothRemoteGATTCharacteristic | null = null
  private emgChar: BluetoothRemoteGATTCharacteristic | null = null
  private statusChar: BluetoothRemoteGATTCharacteristic | null = null
  private hapticChar: BluetoothRemoteGATTCharacteristic | null = null
  private events: SmartPhysioBleClientEvents

  constructor(events: SmartPhysioBleClientEvents = {}) {
    this.events = events
  }

  get deviceName(): string | null {
    return this.device?.name ?? null
  }

  get isConnected(): boolean {
    return !!this.server?.connected
  }

  async connect(): Promise<void> {
    if (!isWebBluetoothSupported()) {
      const message = 'Web Bluetooth is not supported in this browser.'
      this.events.onConnectionChange?.('error', message)
      throw new Error(message)
    }

    this.events.onConnectionChange?.('connecting')
    try {
      const device = await navigator.bluetooth!.requestDevice({
        filters: [{ services: [SMARTPHYSIO_SERVICE_UUID] }],
        optionalServices: [SMARTPHYSIO_SERVICE_UUID],
      })
      this.device = device
      device.addEventListener('gattserverdisconnected', this.handleDisconnected)

      if (!device.gatt) throw new Error('Selected device has no GATT server.')
      const server = await device.gatt.connect()
      this.server = server

      const service = await server.getPrimaryService(SMARTPHYSIO_SERVICE_UUID)

      this.imuChar = await service.getCharacteristic(CHARACTERISTIC_UUID.IMU_DATA)
      this.emgChar = await service.getCharacteristic(CHARACTERISTIC_UUID.EMG_DATA)
      this.statusChar = await service.getCharacteristic(CHARACTERISTIC_UUID.POD_STATUS)
      this.hapticChar = await service.getCharacteristic(CHARACTERISTIC_UUID.HAPTIC_CONTROL)

      await this.imuChar.startNotifications()
      this.imuChar.addEventListener('characteristicvaluechanged', this.handleImu)

      await this.emgChar.startNotifications()
      this.emgChar.addEventListener('characteristicvaluechanged', this.handleEmg)

      await this.statusChar.startNotifications()
      this.statusChar.addEventListener('characteristicvaluechanged', this.handleStatus)

      this.events.onConnectionChange?.('connected', device.name ?? undefined)
    } catch (err) {
      const message = describeBleError(err)
      this.cleanup()
      this.events.onConnectionChange?.('error', message)
      throw err
    }
  }

  /** Politely closes the connection. Triggers the same disconnected path as an unexpected drop. */
  disconnect(): void {
    this.server?.disconnect()
  }

  async sendHaptic(podId: PodId, durationMs: number): Promise<void> {
    if (!this.hapticChar) throw new Error('Not connected to a SmartPhysio hub.')
    await this.hapticChar.writeValueWithoutResponse(encodeHapticCommand(podId, durationMs))
  }

  private handleDisconnected = () => {
    this.cleanup()
    this.events.onConnectionChange?.('disconnected')
  }

  private handleImu = (ev: Event) => {
    const char = ev.target as BluetoothRemoteGATTCharacteristic
    if (char.value) this.events.onImu?.(decodeImuPacket(char.value))
  }

  private handleEmg = (ev: Event) => {
    const char = ev.target as BluetoothRemoteGATTCharacteristic
    if (char.value) this.events.onEmg?.(decodeEmgPacket(char.value))
  }

  private handleStatus = (ev: Event) => {
    const char = ev.target as BluetoothRemoteGATTCharacteristic
    if (char.value) this.events.onPodStatus?.(decodePodStatusPacket(char.value))
  }

  private cleanup() {
    this.device?.removeEventListener('gattserverdisconnected', this.handleDisconnected)
    this.imuChar?.removeEventListener('characteristicvaluechanged', this.handleImu)
    this.emgChar?.removeEventListener('characteristicvaluechanged', this.handleEmg)
    this.statusChar?.removeEventListener('characteristicvaluechanged', this.handleStatus)
    this.device = null
    this.server = null
    this.imuChar = null
    this.emgChar = null
    this.statusChar = null
    this.hapticChar = null
  }
}
