# SmartPhysio Hub Firmware

Arduino sketch for the ESP32 hub that streams sensor data to the SmartPhysio
web app over WebSockets. The board hosts its own WiFi network and a
WebSocket server — your phone or laptop connects straight to it, no router
or internet required.

## What you need

- An ESP32 dev board (written against an ESP32-WROOM-32D)
- An MPU6050 IMU breakout, wired over I2C
- (Optional) a vibration motor for haptic feedback, driven through a transistor

## Wiring

| MPU6050 pin | ESP32 pin      |
|-------------|----------------|
| VCC         | 3V3            |
| GND         | GND            |
| SDA         | GPIO 21        |
| SCL         | GPIO 22        |

If you have a vibration motor, wire it through an NPN transistor (or a motor
driver) switched by **GPIO 4**, not directly to the pin — a GPIO can't
supply the current a motor needs. If you don't have one wired yet, the
firmware still runs fine; haptic commands just have no physical effect.

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
   - **MPU6050_light** by rfetick
   - **ArduinoJson** by Benoit Blanchon — version 7.x
4. Open `smartphysio_hub/smartphysio_hub.ino` and click Upload.
5. Open the Serial Monitor at **115200 baud**. On boot it calibrates the
   MPU6050 (keep the pod still for a second) and then prints the WebSocket
   address to connect to, e.g.:
   ```
   Access point "SmartPhysio-Hub" started. Connect the app to ws://192.168.4.1:81
   ```

## Connecting from the app

1. On your phone or laptop, join the WiFi network **SmartPhysio-Hub**
   (password `physio123`) — the same one the ESP32 just created.
2. In the app's Sensor Setup screen, enter the address printed on boot
   (defaults to `ws://192.168.4.1:81`) and hit **Connect**.

Because the ESP32 *is* the WiFi network, joining it disconnects your device
from any other WiFi (and its internet access) for as long as you're paired —
that's expected.

## Changing which pod this board reports as

The app's placement guide treats pods 3–4 as the knee IMU/haptic pair. If
you're strapping the sensor somewhere else, change `POD_ID` near the top of
the sketch to match.

## Protocol

The exact JSON message shapes this firmware sends and accepts are documented
in [`frontend/src/lib/hub/protocol.ts`](../frontend/src/lib/hub/protocol.ts).
In short:

- Hub → app: `{"type":"imu","podId":3,"pitch":12.3,"roll":-4.1,"yaw":0.8}`
  roughly 20 times a second, plus a `{"type":"status", ...}` battery/signal
  message every 2 seconds.
- App → hub: `{"type":"haptic","podId":3,"durationMs":400}` to pulse the
  vibration motor.

## Adding EMG later

The web app's calibration flow and protocol already support an `"emg"`
message type (normalized 0–1 muscle activation per pod), but this sketch
doesn't send one yet since no EMG hardware is wired up. To add it: read an
EMG sensor's rectified/filtered output on an ADC pin, normalize it to 0–1,
and broadcast `{"type":"emg","podId":<id>,"vrms":<0..1>}` on the same timer
as the IMU packets above.
