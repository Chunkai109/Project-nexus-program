import {
  DEFAULT_HUB_WS_URL,
  encodeHapticCommand,
  parseHubMessage,
  type EmgPacket,
  type ImuPacket,
  type PodId,
  type PodStatusPacket,
} from './protocol'

export type HubConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface SmartPhysioSocketClientEvents {
  onImu?: (packet: ImuPacket) => void
  onEmg?: (packet: EmgPacket) => void
  onPodStatus?: (packet: PodStatusPacket) => void
  onConnectionChange?: (state: HubConnectionState, detail?: string) => void
}

export function isWebSocketSupported(): boolean {
  return typeof WebSocket !== 'undefined'
}

/**
 * WebSocket client for a SmartPhysio ESP32 hub, per the protocol documented
 * in ./protocol.ts. The ESP32 hosts its own WiFi access point (default SSID
 * "SmartPhysio-Hub") and a WebSocket server at ws://192.168.4.1:81 — the
 * phone or laptop needs to join that network before connecting.
 */
export class SmartPhysioSocketClient {
  private socket: WebSocket | null = null
  private deviceLabel: string | null = null
  private events: SmartPhysioSocketClientEvents

  constructor(events: SmartPhysioSocketClientEvents = {}) {
    this.events = events
  }

  get deviceName(): string | null {
    return this.deviceLabel
  }

  get isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN
  }

  connect(url: string = DEFAULT_HUB_WS_URL): Promise<void> {
    if (!isWebSocketSupported()) {
      const message = 'WebSockets are not supported in this browser.'
      this.events.onConnectionChange?.('error', message)
      return Promise.reject(new Error(message))
    }

    this.events.onConnectionChange?.('connecting')

    return new Promise((resolve, reject) => {
      let settled = false
      let socket: WebSocket
      try {
        socket = new WebSocket(url)
      } catch {
        const message = `Couldn't open a connection to ${url}.`
        this.events.onConnectionChange?.('error', message)
        reject(new Error(message))
        return
      }
      this.socket = socket

      socket.onopen = () => {
        settled = true
        this.deviceLabel = 'SmartPhysio Hub'
        this.events.onConnectionChange?.('connected', this.deviceLabel)
        resolve()
      }

      socket.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return
        const msg = parseHubMessage(ev.data)
        if (!msg) return
        if (msg.type === 'imu') this.events.onImu?.(msg)
        else if (msg.type === 'emg') this.events.onEmg?.(msg)
        else if (msg.type === 'status') this.events.onPodStatus?.(msg)
        else if (msg.type === 'hello') this.deviceLabel = msg.device
      }

      // WebSocket error events carry no diagnostic detail (a browser
      // security restriction) — the close event that always follows is
      // where connect-vs-drop is actually distinguished, via `settled`.
      socket.onerror = () => {}

      socket.onclose = () => {
        this.cleanup()
        if (!settled) {
          settled = true
          const message = "Couldn't reach the ESP32 hub — check it's powered on and you're connected to its WiFi network."
          this.events.onConnectionChange?.('error', message)
          reject(new Error(message))
        } else {
          this.events.onConnectionChange?.('disconnected')
        }
      }
    })
  }

  /** Politely closes the connection. Triggers the same disconnected path as an unexpected drop. */
  disconnect(): void {
    this.socket?.close()
  }

  async sendHaptic(podId: PodId, durationMs: number): Promise<void> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to a SmartPhysio hub.')
    }
    this.socket.send(encodeHapticCommand(podId, durationMs))
  }

  private cleanup() {
    if (this.socket) {
      this.socket.onopen = null
      this.socket.onmessage = null
      this.socket.onerror = null
      this.socket.onclose = null
    }
    this.socket = null
  }
}
