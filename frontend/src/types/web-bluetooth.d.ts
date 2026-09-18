// Minimal ambient types for the experimental Web Bluetooth API,
// scoped to only what this project's BLE bridge stub touches.
interface BluetoothDevice {
  id: string
  name?: string
}

interface BluetoothRequestDeviceFilter {
  namePrefix?: string
  services?: string[]
}

interface RequestDeviceOptions {
  filters: BluetoothRequestDeviceFilter[]
  optionalServices?: string[]
}

interface Bluetooth {
  requestDevice(options: RequestDeviceOptions): Promise<BluetoothDevice>
}

interface Navigator {
  bluetooth?: Bluetooth
}
