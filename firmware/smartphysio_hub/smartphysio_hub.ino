/*
 * SmartPhysio Hub — ESP32 + MPU6050 WebSocket firmware
 * =====================================================
 *
 * Hosts its own WiFi access point and a WebSocket server so the SmartPhysio
 * web app can connect directly to this board — no router or internet
 * required. Streams fused IMU orientation (pitch/roll/yaw) for one pod as
 * JSON text frames, and accepts a "haptic" command back to pulse a
 * vibration motor.
 *
 * This is written directly against each library's documented API but has
 * not been run against real hardware from this environment (no Arduino
 * toolchain here) — flash it and watch the Serial Monitor at 115200 baud
 * if anything doesn't come up the way you expect.
 *
 * See firmware/README.md for wiring + library install steps, and
 * frontend/src/lib/hub/protocol.ts for the JSON message contract this
 * firmware implements.
 *
 * Libraries (Arduino IDE: Sketch > Include Library > Manage Libraries):
 *   - "WebSockets" by Markus Sattler (Links2004)
 *   - "MPU6050_light" by rfetick
 *   - "ArduinoJson" by Benoit Blanchon (v7.x)
 *
 * Board: any ESP32 dev board (written against an ESP32-WROOM-32D).
 */

#include <WiFi.h>
#include <WebSocketsServer.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <MPU6050_light.h>

// ---------------------------------------------------------------------------
// Configuration — adjust these for your wiring
// ---------------------------------------------------------------------------

// Which SmartPhysio pod slot this board reports as. Pods 3-4 are the knee
// IMU/haptic pair in the app's placement guide (see SensorSetup.tsx) —
// change this if you're strapping the sensor to a different joint.
constexpr uint8_t POD_ID = 3;

const char *AP_SSID = "SmartPhysio-Hub";
const char *AP_PASSWORD = "physio123";  // WPA2 requires 8+ characters

constexpr uint16_t WS_PORT = 81;

// Default ESP32 dev board I2C pinout for the MPU6050.
constexpr int I2C_SDA_PIN = 21;
constexpr int I2C_SCL_PIN = 22;

// Optional vibration motor output. Drive an ERM/LRA motor through a
// transistor (never straight off a GPIO — it can't supply enough current) if
// you have one wired; if nothing is connected, haptic commands just toggle
// an unconnected pin and have no physical effect.
constexpr int HAPTIC_PIN = 4;

constexpr unsigned long IMU_INTERVAL_MS = 50;     // ~20 Hz orientation stream
constexpr unsigned long STATUS_INTERVAL_MS = 2000;

// ---------------------------------------------------------------------------

WebSocketsServer webSocket(WS_PORT);
MPU6050 mpu(Wire);

unsigned long lastImuSentAt = 0;
unsigned long lastStatusSentAt = 0;
unsigned long hapticOffAt = 0;
uint8_t connectedClientCount = 0;

void broadcastJson(JsonDocument &doc) {
  String out;
  serializeJson(doc, out);
  webSocket.broadcastTXT(out);
}

void sendHello(uint8_t clientNum) {
  JsonDocument doc;
  doc["type"] = "hello";
  doc["device"] = "SmartPhysio Hub";
  String out;
  serializeJson(doc, out);
  webSocket.sendTXT(clientNum, out);
}

void handleHapticCommand(JsonDocument &doc) {
  uint8_t podId = doc["podId"] | 0;
  unsigned long durationMs = doc["durationMs"] | 0UL;
  if (podId != POD_ID || durationMs == 0) return;

  digitalWrite(HAPTIC_PIN, HIGH);
  hapticOffAt = millis() + durationMs;
}

void onWebSocketEvent(uint8_t clientNum, WStype_t type, uint8_t *payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      connectedClientCount++;
      sendHello(clientNum);
      break;

    case WStype_DISCONNECTED:
      if (connectedClientCount > 0) connectedClientCount--;
      break;

    case WStype_TEXT: {
      JsonDocument doc;
      if (deserializeJson(doc, payload, length) != DeserializationError::Ok) return;
      const char *msgType = doc["type"] | "";
      if (strcmp(msgType, "haptic") == 0) handleHapticCommand(doc);
      break;
    }

    default:
      break;
  }
}

void setup() {
  Serial.begin(115200);

  pinMode(HAPTIC_PIN, OUTPUT);
  digitalWrite(HAPTIC_PIN, LOW);

  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  byte mpuStatus = mpu.begin();
  while (mpuStatus != 0) {
    Serial.printf("MPU6050 init failed (status %d) — check wiring, retrying...\n", mpuStatus);
    delay(500);
    mpuStatus = mpu.begin();
  }
  Serial.println("MPU6050 found. Keep the pod still for offset calibration...");
  mpu.calcOffsets();
  Serial.println("MPU6050 ready.");

  WiFi.softAP(AP_SSID, AP_PASSWORD);
  Serial.print("Access point \"");
  Serial.print(AP_SSID);
  Serial.print("\" started. Connect the app to ws://");
  Serial.print(WiFi.softAPIP());
  Serial.print(":");
  Serial.println(WS_PORT);

  webSocket.begin();
  webSocket.onEvent(onWebSocketEvent);
}

void loop() {
  webSocket.loop();
  mpu.update();

  unsigned long now = millis();

  if (hapticOffAt != 0 && now >= hapticOffAt) {
    digitalWrite(HAPTIC_PIN, LOW);
    hapticOffAt = 0;
  }

  bool hasClient = connectedClientCount > 0;

  if (hasClient && now - lastImuSentAt >= IMU_INTERVAL_MS) {
    lastImuSentAt = now;
    JsonDocument doc;
    doc["type"] = "imu";
    doc["podId"] = POD_ID;
    // MPU6050_light's X/Y angles are rotation about those axes (roll/pitch);
    // swap or negate these to match however the pod ends up strapped to the
    // limb. Z (yaw) is gyro-integrated only — this chip has no magnetometer,
    // so yaw will slowly drift and isn't meant for absolute heading.
    doc["pitch"] = mpu.getAngleY();
    doc["roll"] = mpu.getAngleX();
    doc["yaw"] = mpu.getAngleZ();
    broadcastJson(doc);
  }

  if (hasClient && now - lastStatusSentAt >= STATUS_INTERVAL_MS) {
    lastStatusSentAt = now;
    JsonDocument doc;
    doc["type"] = "status";
    doc["podId"] = POD_ID;
    // No battery-monitoring circuit wired yet — placeholder until a voltage
    // divider is added to an ADC pin. Signal is "strong" whenever a client
    // holds a live connection to this board's own access point.
    doc["battery"] = 100;
    doc["signal"] = "strong";
    broadcastJson(doc);
  }
}
