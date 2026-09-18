// Ambient types for the experimental Web Bluetooth API — not yet part of
// TypeScript's lib.dom.d.ts — scoped to what SmartPhysioBleClient touches.
interface BluetoothRemoteGATTDescriptor {
  readonly characteristic: BluetoothRemoteGATTCharacteristic
  readonly uuid: string
  readonly value?: DataView
  readValue(): Promise<DataView>
  writeValue(value: BufferSource): Promise<void>
}

interface BluetoothCharacteristicProperties {
  readonly broadcast: boolean
  readonly read: boolean
  readonly writeWithoutResponse: boolean
  readonly write: boolean
  readonly notify: boolean
  readonly indicate: boolean
  readonly authenticatedSignedWrites: boolean
  readonly reliableWrite: boolean
  readonly writableAuxiliaries: boolean
}

interface BluetoothRemoteGATTCharacteristic extends EventTarget {
  readonly service: BluetoothRemoteGATTService
  readonly uuid: string
  readonly properties: BluetoothCharacteristicProperties
  readonly value?: DataView
  getDescriptor(descriptor: string): Promise<BluetoothRemoteGATTDescriptor>
  getDescriptors(descriptor?: string): Promise<BluetoothRemoteGATTDescriptor[]>
  readValue(): Promise<DataView>
  writeValue(value: BufferSource): Promise<void>
  writeValueWithResponse(value: BufferSource): Promise<void>
  writeValueWithoutResponse(value: BufferSource): Promise<void>
  startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>
  stopNotifications(): Promise<BluetoothRemoteGATTCharacteristic>
  addEventListener(
    type: 'characteristicvaluechanged',
    listener: (this: BluetoothRemoteGATTCharacteristic, ev: Event) => void,
  ): void
  removeEventListener(
    type: 'characteristicvaluechanged',
    listener: (this: BluetoothRemoteGATTCharacteristic, ev: Event) => void,
  ): void
}

interface BluetoothRemoteGATTService extends EventTarget {
  readonly device: BluetoothDevice
  readonly uuid: string
  readonly isPrimary: boolean
  getCharacteristic(characteristic: string): Promise<BluetoothRemoteGATTCharacteristic>
  getCharacteristics(characteristic?: string): Promise<BluetoothRemoteGATTCharacteristic[]>
}

interface BluetoothRemoteGATTServer {
  readonly device: BluetoothDevice
  readonly connected: boolean
  connect(): Promise<BluetoothRemoteGATTServer>
  disconnect(): void
  getPrimaryService(service: string): Promise<BluetoothRemoteGATTService>
  getPrimaryServices(service?: string): Promise<BluetoothRemoteGATTService[]>
}

interface BluetoothDevice extends EventTarget {
  readonly id: string
  readonly name?: string
  readonly gatt?: BluetoothRemoteGATTServer
  addEventListener(type: 'gattserverdisconnected', listener: (this: BluetoothDevice, ev: Event) => void): void
  removeEventListener(type: 'gattserverdisconnected', listener: (this: BluetoothDevice, ev: Event) => void): void
}

interface BluetoothRequestDeviceFilter {
  services?: string[]
  name?: string
  namePrefix?: string
}

interface RequestDeviceOptions {
  filters?: BluetoothRequestDeviceFilter[]
  acceptAllDevices?: boolean
  optionalServices?: string[]
}

interface Bluetooth extends EventTarget {
  requestDevice(options: RequestDeviceOptions): Promise<BluetoothDevice>
}

interface Navigator {
  bluetooth?: Bluetooth
}
