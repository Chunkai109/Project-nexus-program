# SmartPhysio Hub Firmware

Arduino sketch for the ESP32 hub that streams sensor data to the SmartPhysio
web app over WebSockets. The board hosts its own WiFi network and a
WebSocket server — your phone or laptop connects straight to it, no router
or internet required.

This sketch implements a bicep curl feedback rig: two MPU6050 IMUs (forearm
flexion + upper-arm drift), an EMG sensor, and a vibration motor that fires
only on command from the dashboard. **Rep counting, drift/cheat detection,
and the target-corridor haptic trigger all live entirely on the dashboard**
(`frontend/src/lib/hub/bicepCurlCounter.ts` and `LiveSession.tsx`) — this
board just streams raw flexion/drift and has no rep-counting or vibration
decision logic of its own; see [Protocol](#protocol) below.

**EMG is enabled** (`EMG_ENABLED = true` near the top of the sketch). Raw
ADC readings above `EMG_NOISE_THRESHOLD` (1000, out of the ESP32's 12-bit
0-4095 range) are treated as motion/contact noise rather than muscle
activation and are filtered out in `processEmgSample()` before the value is
sent to the dashboard — that function holds the last accepted reading
instead of letting a spike through, so the processed value is always
`<= EMG_NOISE_THRESHOLD`. Set `EMG_ENABLED` back to `false` if you're running
without the EMG sensor wired up — the two MPU6050s, WiFi/WebSocket link and
vibration motor all work fully without it.

## What you need

- An ESP32 dev board (written against an ESP32-WROOM-32D)
- Two MPU6050 IMU breakouts, wired over the same I2C bus at different
  addresses (via the AD0 pin)
- An EMG sensor module with an analog envelope output (required while
  `EMG_ENABLED` is `true`, the default)
- A vibration motor for haptic feedback, driven through a transistor

## Wiring

| Component            | Pin(s)          | ESP32 pin |
|-----------------------|-----------------|-----------|
| MPU6050 #1 (forearm)  | VCC / GND       | 3V3 / GND |
|                        | SDA / SCL       | GPIO 21 / GPIO 22 |
|                        | AD0             | GND (address `0x68`) |
| MPU6050 #2 (upper arm)| VCC / GND       | 3V3 / GND |
|                        | SDA / SCL       | GPIO 21 / GPIO 22 (shared bus) |
|                        | AD0             | 3.3V (address `0x69`) |
| EMG sensor (required while `EMG_ENABLED` is `true`) | Signal / envelope out | GPIO 35 (ADC1) |
| Vibration motor       | Control         | GPIO 25, through an NPN transistor |

Both MPU6050s share the same I2C bus (SDA/SCL) — tying one's `AD0` pin to
GND and the other's to 3.3V gives them different addresses (`0x68`/`0x69`)
so the ESP32 can read them independently. Wire the vibration motor through
a transistor or motor driver, not directly to the GPIO — it can't supply
the current a motor needs.

## Arduino IDE setup

1. Install the **ESP32 board package** if you haven't already: in
   Arduino IDE, go to *File > Preferences* and add this Additional Board
   Manager URL:
   `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`
   Then *Tools > Board > Boards Manager*, search "esp32", install it.
2. Select your board under *Tools > Board > ESP32 Arduino* (e.g. "ESP32 Dev
   Module") and pick the correct *Port*.
3. Install these libraries via *Sketch > Include Library > Manage Libraries*:
   - **WebSockets** by Markus Sattler (Links2004)
   - **ArduinoJson** by Benoit Blanchon — version 7.x

   (No IMU library is needed — this sketch talks to the MPU6050s directly
   over I2C registers.)
4. Open `smartphysio_hub/smartphysio_hub.ino` and click Upload.
5. Open the Serial Monitor at **115200 baud**. On boot it calibrates both
   gyros (keep the arm still for a second) and then prints the WebSocket
   address to connect to, e.g.:
   ```
   Access point "SmartPhysio-Hub" started. Connect the dashboard to ws://192.168.4.1:81
   ```

## Connecting from the app

1. On your phone or laptop, join the WiFi network **SmartPhysio-Hub**
   (password `physio123`) — the same one the ESP32 just created.
2. In the app's Sensor Setup screen, enter the address printed on boot
   (defaults to `ws://192.168.4.1:81`) and hit **Connect**.

Because the ESP32 *is* the WiFi network, joining it disconnects your device
from any other WiFi (and its internet access) for as long as you're paired —
that's expected.

## Pod ID mapping

| Pod ID | Sensor                          |
|--------|----------------------------------|
| 1      | EMG envelope (bicep) — not reported if `EMG_ENABLED` is set back to `false` |
| 2      | MPU6050 #1 — forearm flexion     |
| 3      | MPU6050 #2 — upper-arm drift     |

Change the `POD_EMG` / `POD_FOREARM` / `POD_UPPERARM` constants near the top
of the sketch if you want the dashboard to see these under different pod
slots.

## Vibration motor behavior

This board has no autonomous vibration trigger of its own — the motor only
pulses when the dashboard sends a `{"type":"haptic", ...}` message. This
board only has one motor, so a haptic command pulses it regardless of which
podId the app addressed.

The dashboard sends that command in two places:

- The Sensor Setup screen's "Test Pod Vibration" button (a fixed test pulse).
- Live Session, the instant the resolved flexion angle enters the exercise's
  configured target corridor (`targetMin`/`targetMax` on its `AngleConfig` —
  150°-180° for the default Bicep Curl, see `buildDefaultBicepCurlExercise()`
  in `frontend/src/lib/data/AppDataContext.tsx`). It sends a 1000ms pulse
  exactly once per corridor entry (edge-triggered — holding inside the
  corridor doesn't retrigger it); see the corridor-entry effect in
  `frontend/src/pages/LiveSession.tsx`.

The target corridor is purely a dashboard/exercise concept — this firmware
has no knowledge of it and never decides on its own when to buzz.

## Protocol

The exact JSON message shapes this firmware sends and accepts are documented
in [`frontend/src/lib/hub/protocol.ts`](../frontend/src/lib/hub/protocol.ts).
In short:

- Hub → app, roughly 50 times a second: `{"type":"imu","podId":2,"pitch":12.3}`
  (flexion) and `{"type":"imu","podId":3,"pitch":1.8}` (drift) — no roll/yaw,
  since only these two values feed anything on either end. Also
  `{"type":"emg","podId":1,"vrms":0.34}` — `vrms` is the noise-filtered
  envelope (raw ADC reading, spikes over `EMG_NOISE_THRESHOLD` rejected)
  normalized to 0.0-1.0 against that threshold; plus `{"type":"status", ...}`
  battery/signal messages every 2 seconds.
- App → hub: `{"type":"haptic","podId":2,"durationMs":400}` to pulse the
  vibration motor.

Rep counting and the cheat-rep drift check run **only on the dashboard**
(`frontend/src/lib/hub/bicepCurlCounter.ts`, stepped inside `HubProvider`
against these two `pitch` values) for the "Source: Live Hub (MPU)" rep
counter shown in Live Session — with MediaPipe camera detection disabled
(`ENABLE_MEDIAPIPE_VISION` in `LiveSession.tsx`) so that's the only input
driving it. This board has no rep-counting state, and no vibration trigger
of its own either — see [Vibration motor behavior](#vibration-motor-behavior)
above.
