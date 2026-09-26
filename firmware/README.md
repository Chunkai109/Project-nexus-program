# SmartPhysio Hub Firmware

Arduino sketch for the ESP32 hub that streams sensor data to the SmartPhysio
web app over WebSockets. The board hosts its own WiFi network and a
WebSocket server — your phone or laptop connects straight to it, no router
or internet required.

This sketch implements a bicep curl feedback rig: two MPU6050 IMUs (forearm
flexion + upper-arm drift, for cheat-rep detection), an EMG sensor, an
on-device rep counter, and a vibration motor that fires both automatically
(on strong contraction) and on command from the dashboard.

## What you need

- An ESP32 dev board (written against an ESP32-WROOM-32D)
- Two MPU6050 IMU breakouts, wired over the same I2C bus at different
  addresses (via the AD0 pin)
- An EMG sensor module with an analog envelope output
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
| EMG sensor            | Signal / envelope out | GPIO 35 (ADC1) |
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
| 1      | EMG envelope (bicep)             |
| 2      | MPU6050 #1 — forearm flexion     |
| 3      | MPU6050 #2 — upper-arm drift     |

Change the `POD_EMG` / `POD_FOREARM` / `POD_UPPERARM` constants near the top
of the sketch if you want the dashboard to see these under different pod
slots.

## Vibration motor behavior

The motor fires under two independent conditions, either of which turns it
on:

- **Automatic**: EMG activation crosses `EMG_THRESHOLD` while flexion is
  past `CONTRACTION_LIMIT` — the original on-device form feedback.
- **Commanded**: the dashboard sends a `{"type":"haptic", ...}` message
  (e.g. the Sensor Setup screen's "Test Pod Vibration" button). This board
  only has one motor, so a haptic command pulses it regardless of which
  podId the app addressed.

## Protocol

The exact JSON message shapes this firmware sends and accepts are documented
in [`frontend/src/lib/hub/protocol.ts`](../frontend/src/lib/hub/protocol.ts).
In short:

- Hub → app, roughly 50 times a second: `{"type":"imu","podId":2,"pitch":12.3,"roll":-4.1,"yaw":0.8}`
  and `{"type":"emg","podId":1,"vrms":0.34}`, plus `{"type":"status", ...}`
  battery/signal messages every 2 seconds.
- App → hub: `{"type":"haptic","podId":2,"durationMs":400}` to pulse the
  vibration motor.

Rep counting, the cheat-rep drift check, and the automatic vibration trigger
all run entirely on the ESP32 — the WebSocket link is for the dashboard to
observe live sensor data and to trigger the motor manually, not something
the rep logic depends on.
