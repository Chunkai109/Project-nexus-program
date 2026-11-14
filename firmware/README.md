# SmartPhysio Hub Firmware

Arduino sketch for the ESP32 hub that streams sensor data to the SmartPhysio
web app over WebSockets. The board hosts its own WiFi network and a
WebSocket server — your phone or laptop connects straight to it, no router
or internet required.

This sketch implements a bicep curl feedback rig: two MPU6050 IMUs (forearm
flexion + upper-arm drift), an EMG sensor (bicep), and a single vibration
motor strapped on the bicep that fires only on command from the dashboard,
meant to pulse on correct form. **Rep counting, drift/cheat detection, and
the haptic trigger all live entirely on the dashboard**
(`frontend/src/lib/hub/bicepCurlCounter.ts` and `LiveSession.tsx`) — this
board just streams raw flexion/drift/EMG and pulses the motor whenever a
`{"type":"haptic",...}` command arrives; it has no rep-counting or
vibration decision logic of its own; see [Protocol](#protocol) below.

**EMG: Sichiray dry-electrode sEMG on GPIO 34.** The signal is sampled at
1000 Hz in its own FreeRTOS task (so WiFi and WebSocket work in `loop()`
can't make it skip samples; the filters assume exactly 1000 Hz) and
cleaned in three stages, taken from the team's "Filtered Sensor Reader"
sketch:

1. ~20 Hz high-pass: removes the sensor's ~1.5 V DC offset and slow
   movement drift.
2. 50 Hz notch (Q = 15): removes mains hum.
3. RMS over each 20 ms window, then smoothed (`EMG_SMOOTH_ALPHA` = 0.25).

The result, `emgFiltered`, is an RMS in ADC counts. It is sent to the app
divided by `EMG_FULL_SCALE_RMS` (500, capped at 1.0). **Tune that constant
on the rig**: set it a little above the largest `EMG:` value the Serial
Monitor shows during a firm curl. The app turns the 0-1 value into % effort
using the patient's own resting and firm readings from the Check screen.

**IMUs:** flexion = `90 - roll1` (forearm), drift = `roll2 - 90` (upper
arm), from a complementary filter (`ALPHA` = 0.96) on the roll axis with
gyro x offsets calibrated at boot. This is the original hub code, confirmed
working on the rig.

## What you need

- An ESP32 dev board (written against an ESP32-WROOM-32D)
- Two MPU6050 IMU breakouts, wired over the same I2C bus at different
  addresses (via the AD0 pin)
- A Sichiray sEMG sensor with dry electrodes (analog output)
- One vibration motor for haptic feedback, driven through its own transistor

## Wiring

| Component            | Pin(s)          | ESP32 pin |
|-----------------------|-----------------|-----------|
| MPU6050 #1 (forearm)  | VCC / GND       | 3V3 / GND |
|                        | SDA / SCL       | GPIO 21 / GPIO 22 |
|                        | AD0             | GND (address `0x68`) |
| MPU6050 #2 (upper arm)| VCC / GND       | 3V3 / GND |
|                        | SDA / SCL       | GPIO 21 / GPIO 22 (shared bus) |
|                        | AD0             | 3.3V (address `0x69`) |
| Sichiray sEMG sensor (bicep) | Signal out | GPIO 34 (ADC1: ADC2 pins can't be read while WiFi is on) |
| Vibration motor (bicep, correct-form feedback) | Control | GPIO 27, through an NPN transistor |

Both MPU6050s share the same I2C bus (SDA/SCL) — tying one's `AD0` pin to
GND and the other's to 3.3V gives them different addresses (`0x68`/`0x69`)
so the ESP32 can read them independently. Wire the vibration motor through
its own transistor or motor driver, not directly to the GPIO — it can't
supply the current a motor needs.

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
   then one line per 20 ms, in the same format as the team's reference
   sketch: `Flex:  12.3 | Drift:   1.8 | EMG:  42.7`

## Connecting from the app

1. On your phone or laptop, join the WiFi network **SmartPhysio-Hub**
   (password `physio123`) — the same one the ESP32 just created.
2. In the app's Sensor Setup screen, enter the address printed on boot
   (defaults to `ws://192.168.4.1:81`) and hit **Connect**.

Because the ESP32 *is* the WiFi network, joining it disconnects your device
from any other WiFi (and its internet access) for as long as you're paired —
that's expected.

## Pod ID mapping

| Pod ID | Sensor / actuator                          |
|--------|----------------------------------------------|
| 1      | sEMG envelope (bicep)           |
| 2      | MPU6050 #1 — forearm flexion     |
| 3      | MPU6050 #2 — upper-arm drift     |
| 15     | Vibration motor — correct-form feedback (bicep) |

Change the `POD_EMG` / `POD_FOREARM` / `POD_UPPERARM` / `POD_HAPTIC_FORM`
constants near the top of the sketch if you want the dashboard to see these
under different pod slots. 15 was chosen specifically to sit above the
frontend's virtual joint/muscle node range (`frontend/src/lib/joints.ts`,
`muscles.ts` top out at 14) so a haptic command's podId can never collide
with a real or virtual sensor node.

## Vibration motor behavior

This board has no autonomous vibration trigger of its own — the motor only
pulses when the dashboard sends a `{"type":"haptic", ...}` message; any
podId pulses it, since there's only the one motor now (previously two —
a corridor motor and a separate fault motor — now consolidated to this
single motor, meant to pulse on correct form).

The dashboard sends that command in two places:

- Live Session, whenever the AI form check scores a rep **Perfect** — a
  300ms pulse. It arrives once the AI model responds, so it lands slightly
  after the rep finishes, and it needs the AI form-check API running.
- The Sensor Setup screen's "Test Pod Vibration" button (a fixed test pulse).

Whether and when to pulse is a purely dashboard-side decision — this
firmware has no knowledge of the target corridor, the fault/cheat threshold,
or what "correct form" means, and never decides on its own when to buzz.

## Protocol

The exact JSON message shapes this firmware sends and accepts are documented
in [`frontend/src/lib/hub/protocol.ts`](../frontend/src/lib/hub/protocol.ts).
In short:

- Hub → app, at 50 Hz (every 20 ms, all three values from the same
  pass): `{"type":"imu","podId":2,"pitch":12.3}` (flexion) and
  `{"type":"imu","podId":3,"pitch":1.8}` (drift), plus
  `{"type":"emg","podId":1,"vrms":0.34}`, where `vrms` is the filtered
  sEMG envelope divided by `EMG_FULL_SCALE_RMS`, capped at 1.0. Also
  `{"type":"status", ...}` battery/signal messages every 2 seconds.
- App → hub: `{"type":"haptic","podId":15,"durationMs":400}` to pulse the
  vibration motor.

Rep counting and the cheat-rep drift check run **only on the dashboard**
(`frontend/src/lib/hub/bicepCurlCounter.ts`, stepped inside `HubProvider`
against these two `pitch` values) for the "Source: Live Hub (MPU)" rep
counter shown in Live Session. The dashboard also runs a MediaPipe
camera-vision model in parallel for AI Form Check and the fused
vision+IMU model, but that's a separate, additive signal — it never
substitutes for this board's flex/drift stream, which is what drives rep
counting. This board has no rep-counting state, and no vibration trigger of
its own either — see [Vibration motor behavior](#vibration-motor-behavior)
above.
