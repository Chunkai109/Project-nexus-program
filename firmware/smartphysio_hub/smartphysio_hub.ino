#include <Wire.h>
#include <math.h>
#include <WiFi.h>
#include <WebSocketsServer.h>
#include <ArduinoJson.h>

#define I2C_SDA 21
#define I2C_SCL 22

// Hardware Peripheral Pins
#define EMG_PIN            35  // Analog pin for EMG envelope/signal
#define VIB_MOTOR_FORM_PIN 25  // Digital output — single motor strapped on the bicep, pulses on correct form

// MPU-6050 Addresses
#define MPU1_ADDR 0x68  // Sensor 1: Forearm (Flexion) -> AD0 to GND
#define MPU2_ADDR 0x69  // Sensor 2: Upper Arm (Drift)  -> AD0 to 3.3V

#define PWR_MGMT_1   0x6B
#define ACCEL_XOUT_H 0x3B

// ---------------------------------------------------------------------------
// Shared types — defined before every function in this file. Arduino's
// auto-generated function prototypes are hoisted above all of them, so any
// type used in a function signature (MPUData, GyroOffsets below) must
// already be declared by this point or the auto-prototype won't compile
// ("'MPUData' has not been declared").
// ---------------------------------------------------------------------------
struct MPUData {
  int16_t ax, ay, az;
  int16_t tempRaw;
  int16_t gx, gy, gz;
};

struct GyroOffsets {
  float gx = 0.0;
};

// ---------------------------------------------------------------------------
// SmartPhysio dashboard link — this board hosts its own WiFi access point
// and a WebSocket server, so the web app connects to it directly with no
// router involved. Message shapes below match what the app expects, per
// frontend/src/lib/hub/protocol.ts.
// ---------------------------------------------------------------------------
const char *AP_SSID = "SmartPhysio-Hub";
const char *AP_PASSWORD = "physio123";  // WPA2 requires 8+ characters
constexpr uint16_t WS_PORT = 81;

// Which pod slot each sensor reports as in the dashboard.
constexpr uint8_t POD_EMG       = 1;  // Bicep EMG envelope
constexpr uint8_t POD_FOREARM   = 2;  // Sensor 1 — flexion
constexpr uint8_t POD_UPPERARM  = 3;  // Sensor 2 — drift

// Which pod ID a "haptic" command must address to pulse the motor. Down to
// one physical motor (see VIB_MOTOR_FORM_PIN above), wired on the bicep,
// meant to pulse only on correct form — previously two motors (a corridor
// motor and a separate fault motor), addressed independently; now any
// haptic command pulses this one. Numbered well past the sensor pods (1-3)
// and this app's virtual joint/muscle node range (frontend/src/lib/joints.ts,
// muscles.ts go up to 14) so a haptic command can never collide with a
// sensor or virtual-node ID.
constexpr uint8_t POD_HAPTIC_FORM = 15;

constexpr unsigned long STATUS_INTERVAL_MS = 2000;

// Both IMU sensors and the EMG sensor are sampled and broadcast together,
// once per SAMPLE_INTERVAL_MS — see the millis()-gated check at the top of
// loop(). Driving all three off one shared, explicit interval (rather than
// each drifting with however long the previous loop iteration happened to
// take) is what keeps their readings aligned to the same instant.
constexpr unsigned long SAMPLE_INTERVAL_MS = 20; // 50 Hz
unsigned long lastSampleAt = 0;

WebSocketsServer webSocket(WS_PORT);
uint8_t connectedClientCount = 0;
unsigned long lastStatusSentAt = 0;
unsigned long formMotorOffAt = 0;  // millis() deadline for the motor's app-commanded pulse

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
  // One physical motor now -- any haptic command pulses it, regardless of
  // podId, so an unrecognized podId still does something sensible rather
  // than silently no-op'ing.
  unsigned long durationMs = doc["durationMs"] | 0UL;
  if (durationMs == 0) return;
  formMotorOffAt = millis() + durationMs;
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

GyroOffsets calib1, calib2;

// Filtered Orientation Angles — only the roll axis is needed (flexion is
// derived from Sensor 1's roll, drift from Sensor 2's), so pitch/yaw are
// never computed at all rather than computed and left unused.
float roll1 = 0.0; // Forearm
float roll2 = 0.0; // Upper Arm
const float ALPHA = 0.96;

unsigned long prevTime = 0;

// EMG sensor is wired to EMG_PIN. Raw ADC readings spike well above real
// muscle activation on motion/contact artifacts, so processEmgSample()
// below rejects any raw sample over EMG_NOISE_THRESHOLD — those readings
// don't count towards the envelope sent to the dashboard.
constexpr bool EMG_ENABLED = true;
constexpr int EMG_NOISE_THRESHOLD = 1000; // ESP32 ADC is 12-bit (0-4095); readings above this are noise, not signal

int lastValidEmgRaw = 0;

// Filters the EMG envelope: a raw sample over EMG_NOISE_THRESHOLD is treated
// as a noise spike and discarded by holding the last accepted reading
// instead of letting it through, so the processed value is always
// <= EMG_NOISE_THRESHOLD.
int processEmgSample(int rawSample) {
  if (rawSample <= EMG_NOISE_THRESHOLD) {
    lastValidEmgRaw = rawSample;
  }
  return lastValidEmgRaw;
}

bool initSensor(uint8_t addr) {
  Wire.beginTransmission(addr);
  Wire.write(PWR_MGMT_1);
  Wire.write(0x00); // Wake up MPU-6050
  return (Wire.endTransmission() == 0);
}

bool readSensor(uint8_t addr, MPUData &data) {
  Wire.beginTransmission(addr);
  Wire.write(ACCEL_XOUT_H);
  if (Wire.endTransmission(false) != 0) return false;

  if (Wire.requestFrom((int)addr, 14, true) == 14) {
    data.ax = (Wire.read() << 8) | Wire.read();
    data.ay = (Wire.read() << 8) | Wire.read();
    data.az = (Wire.read() << 8) | Wire.read();
    data.tempRaw = (Wire.read() << 8) | Wire.read();
    data.gx = (Wire.read() << 8) | Wire.read();
    data.gy = (Wire.read() << 8) | Wire.read();
    data.gz = (Wire.read() << 8) | Wire.read();
    return true;
  }
  return false;
}

void calibrateGyro(uint8_t addr, GyroOffsets &calib, const char* name) {
  Serial.print("Calibrating "); Serial.print(name);
  Serial.println("... Keep arm still!");
  long sum_gx = 0;
  MPUData d;
  for (int i = 0; i < 400; i++) {
    if (readSensor(addr, d)) {
      sum_gx += d.gx;
    }
    delay(3);
  }
  calib.gx = (sum_gx / 400.0) / 131.0;
}

void setup() {
  Serial.begin(115200);
  while (!Serial) delay(10);

  pinMode(VIB_MOTOR_FORM_PIN, OUTPUT);
  digitalWrite(VIB_MOTOR_FORM_PIN, LOW);

  analogReadResolution(12); // ESP32 ADC: 0 to 4095

  Wire.begin(I2C_SDA, I2C_SCL);
  Wire.setClock(400000);

  Serial.println(EMG_ENABLED
                    ? "\n--- Bicep Curl Feedback System (Dual MPU + EMG + Haptic) ---"
                    : "\n--- Bicep Curl Feedback System (Dual MPU + Haptic, EMG disabled) ---");

  if (!initSensor(MPU1_ADDR)) Serial.println("Sensor 1 (0x68) NOT detected!");
  if (!initSensor(MPU2_ADDR)) Serial.println("Sensor 2 (0x69) NOT detected!");

  delay(200);
  calibrateGyro(MPU1_ADDR, calib1, "Sensor 1 (Flexion)");
  calibrateGyro(MPU2_ADDR, calib2, "Sensor 2 (Drift)");

  // Seed angles from gravity vectors
  MPUData d1, d2;
  if (readSensor(MPU1_ADDR, d1)) {
    float ay = d1.ay / 16384.0, az = d1.az / 16384.0;
    roll1 = atan2(ay, az) * 180.0 / M_PI;
  }
  if (readSensor(MPU2_ADDR, d2)) {
    float ay = d2.ay / 16384.0, az = d2.az / 16384.0;
    roll2 = atan2(ay, az) * 180.0 / M_PI;
  }

  WiFi.softAP(AP_SSID, AP_PASSWORD);
  Serial.print("Access point \"");
  Serial.print(AP_SSID);
  Serial.print("\" started. Connect the dashboard to ws://");
  Serial.print(WiFi.softAPIP());
  Serial.print(":");
  Serial.println(WS_PORT);

  webSocket.begin();
  webSocket.onEvent(onWebSocketEvent);

  prevTime = micros();
  Serial.println("System Ready! Let your arm hang down naturally.\n");
}

void loop() {
  webSocket.loop();

  // Gate sensor sampling to a fixed wall-clock interval instead of a
  // blocking delay() at the bottom of loop() — that way webSocket.loop()
  // (haptic commands, client connect/disconnect) keeps getting serviced
  // every pass, and the IMU/EMG sampling below only fires once per
  // SAMPLE_INTERVAL_MS regardless of how long I2C reads or the previous
  // broadcast happened to take.
  unsigned long nowMs = millis();
  if (nowMs - lastSampleAt < SAMPLE_INTERVAL_MS) return;
  lastSampleAt = nowMs;

  unsigned long curTime = micros();
  float dt = (curTime - prevTime) / 1000000.0;
  prevTime = curTime;

  MPUData d1, d2;

  // 1. Read and filter Sensor 1 (Forearm)
  if (readSensor(MPU1_ADDR, d1)) {
    float ay = d1.ay / 16384.0, az = d1.az / 16384.0;
    float gx = (d1.gx / 131.0) - calib1.gx;
    float accelRoll = atan2(ay, az) * 180.0 / M_PI;
    roll1 = ALPHA * (roll1 + gx * dt) + (1.0 - ALPHA) * accelRoll;
  }

  // 2. Read and filter Sensor 2 (Upper Arm)
  if (readSensor(MPU2_ADDR, d2)) {
    float ay = d2.ay / 16384.0, az = d2.az / 16384.0;
    float gx = (d2.gx / 131.0) - calib2.gx;
    float accelRoll = atan2(ay, az) * 180.0 / M_PI;
    roll2 = ALPHA * (roll2 + gx * dt) + (1.0 - ALPHA) * accelRoll;
  }

  // 3. Sensor Angle Formulas
  float flexion = 90-roll1; // Sensor 1
  float drift   = roll2-90;            // Sensor 2

  // 4. Sample and filter the EMG sensor (skipped while disabled — see EMG_ENABLED above)
  int emgRaw = EMG_ENABLED ? analogRead(EMG_PIN) : 0;
  int emgProcessed = EMG_ENABLED ? processEmgSample(emgRaw) : 0;

  // 5. Vibration Motor Trigger Condition:
  // This board has no autonomous vibration trigger of its own — whether and
  // when to pulse is entirely a dashboard-side decision, communicated over
  // WebSocket as an explicit "haptic" command (handleHapticCommand() above).
  // The motor is meant to pulse only on correct form, but as of this
  // writing nothing on the dashboard sends that trigger during a live
  // session (LiveSession.tsx issues no haptic commands at all) — the only
  // thing that currently pulses it is the "Test Pod Vibration" button on
  // the Sensor Setup page.
  bool formVibActive = false;
  if (formMotorOffAt != 0) {
    if (millis() < formMotorOffAt) {
      formVibActive = true;
    } else {
      formMotorOffAt = 0;
    }
  }
  digitalWrite(VIB_MOTOR_FORM_PIN, formVibActive ? HIGH : LOW);

  // 6. Stream live telemetry to the dashboard, if it's connected. Rep
  // counting and drift/cheat detection run entirely on the dashboard now
  // (frontend/src/lib/hub/bicepCurlCounter.ts) against these two raw
  // values, so this board just relays them — no roll/yaw, since nothing on
  // either end uses them, and no on-device rep state at all.
  if (connectedClientCount > 0) {
    JsonDocument forearmDoc;
    forearmDoc["type"] = "imu";
    forearmDoc["podId"] = POD_FOREARM;
    forearmDoc["pitch"] = flexion;
    broadcastJson(forearmDoc);

    JsonDocument upperArmDoc;
    upperArmDoc["type"] = "imu";
    upperArmDoc["podId"] = POD_UPPERARM;
    upperArmDoc["pitch"] = drift;
    broadcastJson(upperArmDoc);

    if (EMG_ENABLED) {
      JsonDocument emgDoc;
      emgDoc["type"] = "emg";
      emgDoc["podId"] = POD_EMG;
      emgDoc["vrms"] = emgProcessed / (float)EMG_NOISE_THRESHOLD; // normalized against the filtered full-scale
      broadcastJson(emgDoc);
    }

    unsigned long wsNow = millis();
    if (wsNow - lastStatusSentAt >= STATUS_INTERVAL_MS) {
      lastStatusSentAt = wsNow;
      if (EMG_ENABLED) {
        JsonDocument statusDoc;
        statusDoc["type"] = "status";
        statusDoc["podId"] = POD_EMG;
        statusDoc["battery"] = 100;
        statusDoc["signal"] = "strong";
        broadcastJson(statusDoc);
      }
      const uint8_t statusPods[2] = { POD_FOREARM, POD_UPPERARM };
      for (uint8_t i = 0; i < 2; i++) {
        JsonDocument statusDoc;
        statusDoc["type"] = "status";
        statusDoc["podId"] = statusPods[i];
        // No battery-monitoring circuit wired yet — placeholder until a
        // voltage divider is added to an ADC pin.
        statusDoc["battery"] = 100;
        statusDoc["signal"] = "strong";
        broadcastJson(statusDoc);
      }
    }
  }

  // Serial Monitor Output
  if (EMG_ENABLED) {
    Serial.printf("Flex: %5.1f | Drift: %5.1f | EMG: %4d | Vib(Form): %s\n",
                  flexion, drift, emgProcessed, formVibActive ? "ON " : "OFF");
  } else {
    Serial.printf("Flex: %5.1f | Drift: %5.1f | Vib(Form): %s\n",
                  flexion, drift, formVibActive ? "ON " : "OFF");
  }
}
