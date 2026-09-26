#include <Wire.h>
#include <math.h>
#include <WiFi.h>
#include <WebSocketsServer.h>
#include <ArduinoJson.h>

#define I2C_SDA 21
#define I2C_SCL 22

// Hardware Peripheral Pins
#define EMG_PIN       35  // Analog pin for EMG envelope/signal
#define VIB_MOTOR_PIN 25  // Digital output to drive vibration motor

// MPU-6050 Addresses
#define MPU1_ADDR 0x68  // Sensor 1: Forearm (Flexion) -> AD0 to GND
#define MPU2_ADDR 0x69  // Sensor 2: Upper Arm (Drift)  -> AD0 to 3.3V

#define PWR_MGMT_1   0x6B
#define ACCEL_XOUT_H 0x3B

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
constexpr uint8_t POD_UPPERARM  = 3;  // Sensor 2 — drift / cheat detection

constexpr unsigned long STATUS_INTERVAL_MS = 2000;

WebSocketsServer webSocket(WS_PORT);
uint8_t connectedClientCount = 0;
unsigned long lastStatusSentAt = 0;
unsigned long hapticOffAt = 0;  // millis() deadline for an app-commanded vibration pulse

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
  // Only one physical motor is wired on this board, so any haptic command
  // pulses it regardless of which podId the app addresses.
  unsigned long durationMs = doc["durationMs"] | 0UL;
  if (durationMs == 0) return;
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

struct MPUData {
  int16_t ax, ay, az;
  int16_t tempRaw;
  int16_t gx, gy, gz;
};

struct GyroOffsets {
  float gx = 0.0;
  float gy = 0.0;
};

GyroOffsets calib1, calib2;

// Filtered Orientation Angles
float roll1 = 0.0, pitch1 = 0.0; // Forearm
float roll2 = 0.0, pitch2 = 0.0; // Upper Arm
const float ALPHA = 0.96;

unsigned long prevTime = 0;

// Baseline Reference for Sensor 2 Drift
float baselineDrift = 0.0;
bool isBaseSet = false;
int settleCount = 0;

// Rep and Form Thresholds
const float START_CURL_LIMIT  = 30.0; // Flexion threshold to begin rep
const float CONTRACTION_LIMIT = 80.0; // Flexion threshold at top of curl
const float EXTENSION_LIMIT   = 20.0; // Flexion threshold when arm returns down
const float DRIFT_TOLERANCE   = 15.0; // Max allowed deviation in Sensor 2 drift
const int   EMG_THRESHOLD     = 500;  // EMG activation threshold

// EMG sensor disabled for now (no hardware wired) — flip back to true once
// it's connected. While false, the auto-vibration trigger below falls back
// to flexion alone and no "emg"/pod-1-"status" WebSocket messages are sent.
constexpr bool EMG_ENABLED = false;

enum RepState { STATE_DOWN, STATE_CURLING, STATE_TOP };
RepState repState = STATE_DOWN;
int repCount = 0;
bool formCheatDetected = false;

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
  long sum_gx = 0, sum_gy = 0;
  MPUData d;
  for (int i = 0; i < 400; i++) {
    if (readSensor(addr, d)) {
      sum_gx += d.gx;
      sum_gy += d.gy;
    }
    delay(3);
  }
  calib.gx = (sum_gx / 400.0) / 131.0;
  calib.gy = (sum_gy / 400.0) / 131.0;
}

void setup() {
  Serial.begin(115200);
  while (!Serial) delay(10);

  pinMode(VIB_MOTOR_PIN, OUTPUT);
  digitalWrite(VIB_MOTOR_PIN, LOW);

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
    float ay = d1.ay / 16384.0, az = d1.az / 16384.0, ax = d1.ax / 16384.0;
    roll1  = atan2(ay, az) * 180.0 / M_PI;
    pitch1 = atan2(-ax, sqrt(ay * ay + az * az)) * 180.0 / M_PI;
  }
  if (readSensor(MPU2_ADDR, d2)) {
    float ay = d2.ay / 16384.0, az = d2.az / 16384.0, ax = d2.ax / 16384.0;
    roll2  = atan2(ay, az) * 180.0 / M_PI;
    pitch2 = atan2(-ax, sqrt(ay * ay + az * az)) * 180.0 / M_PI;
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

  unsigned long curTime = micros();
  float dt = (curTime - prevTime) / 1000000.0;
  prevTime = curTime;

  MPUData d1, d2;

  // 1. Read and filter Sensor 1 (Forearm)
  if (readSensor(MPU1_ADDR, d1)) {
    float ax = d1.ax / 16384.0, ay = d1.ay / 16384.0, az = d1.az / 16384.0;
    float gx = (d1.gx / 131.0) - calib1.gx;
    float gy = (d1.gy / 131.0) - calib1.gy;

    float accelRoll  = atan2(ay, az) * 180.0 / M_PI;
    float accelPitch = atan2(-ax, sqrt(ay * ay + az * az)) * 180.0 / M_PI;

    roll1  = ALPHA * (roll1 + gx * dt) + (1.0 - ALPHA) * accelRoll;
    pitch1 = ALPHA * (pitch1 + gy * dt) + (1.0 - ALPHA) * accelPitch;
  }

  // 2. Read and filter Sensor 2 (Upper Arm)
  if (readSensor(MPU2_ADDR, d2)) {
    float ax = d2.ax / 16384.0, ay = d2.ay / 16384.0, az = d2.az / 16384.0;
    float gx = (d2.gx / 131.0) - calib2.gx;
    float gy = (d2.gy / 131.0) - calib2.gy;

    float accelRoll  = atan2(ay, az) * 180.0 / M_PI;
    float accelPitch = atan2(-ax, sqrt(ay * ay + az * az)) * 180.0 / M_PI;

    roll2  = ALPHA * (roll2 + gx * dt) + (1.0 - ALPHA) * accelRoll;
    pitch2 = ALPHA * (pitch2 + gy * dt) + (1.0 - ALPHA) * accelPitch;
  }

  // 3. Sensor Angle Formulas
  float flexion = 90-roll1; // Sensor 1
  float drift   = roll2-90;            // Sensor 2

  // 4. Sample EMG Sensor (skipped while disabled — see EMG_ENABLED above)
  int emgRaw = EMG_ENABLED ? analogRead(EMG_PIN) : 0;

  // 5. Baseline Lock for Upper Arm Drift
  if (!isBaseSet) {
    settleCount++;
    if (settleCount > 50) {
      baselineDrift = drift;
      isBaseSet = true;
      Serial.println(">>> Baseline Locked! Ready to curl. <<<\n");
    }
    delay(20);
    return;
  }

  // Drift error calculation
  float driftError = abs(drift - baselineDrift);
  if (driftError > DRIFT_TOLERANCE) {
    formCheatDetected = true;
  }

  // 6. Vibration Motor Trigger Condition:
  // Fires automatically when Flexion > 80 degrees (and, once EMG_ENABLED is
  // flipped back on, also requires EMG > 500 — the original on-device
  // feedback), OR when the dashboard sends an explicit "haptic" command over
  // WebSocket (e.g. the Sensor Setup screen's "Test Pod Vibration" button) —
  // this board only has one motor, so either source can pulse it.
  bool autonomousActive = flexion > CONTRACTION_LIMIT && (!EMG_ENABLED || emgRaw > EMG_THRESHOLD);
  bool appCommandActive = false;
  if (hapticOffAt != 0) {
    if (millis() < hapticOffAt) {
      appCommandActive = true;
    } else {
      hapticOffAt = 0;
    }
  }
  bool motorActive = autonomousActive || appCommandActive;
  digitalWrite(VIB_MOTOR_PIN, motorActive ? HIGH : LOW);

  // 7. Rep State Machine
  const char* stateStr = "DOWN";

  switch (repState) {
    case STATE_DOWN:
      stateStr = "DOWN";
      if (flexion < EXTENSION_LIMIT) {
        baselineDrift = 0.95f * baselineDrift + 0.05f * drift;
        formCheatDetected = false;
      }
      if (flexion > START_CURL_LIMIT) {
        repState = STATE_CURLING;
      }
      break;

    case STATE_CURLING:
      stateStr = "CURLING";
      if (flexion >= CONTRACTION_LIMIT) {
        repState = STATE_TOP;
      } else if (flexion < EXTENSION_LIMIT) {
        repState = STATE_DOWN;
      }
      break;

    case STATE_TOP:
      stateStr = "TOP";
      if (flexion < EXTENSION_LIMIT) {
        if (!formCheatDetected) {
          repCount++;
          Serial.printf("\n====================================\n");
          Serial.printf(">>> GOOD REP #%d COMPLETED! <<<\n", repCount);
          Serial.printf("====================================\n\n");
        } else {
          Serial.printf("\n====================================\n");
          Serial.printf(">>> INVALID REP: Drifted by %.1f deg! <<<\n", driftError);
          Serial.printf("====================================\n\n");
        }
        formCheatDetected = false;
        repState = STATE_DOWN;
      }
      break;
  }

  // 8. Stream live telemetry to the dashboard, if it's connected
  if (connectedClientCount > 0) {
    JsonDocument forearmDoc;
    forearmDoc["type"] = "imu";
    forearmDoc["podId"] = POD_FOREARM;
    forearmDoc["pitch"] = flexion;
    forearmDoc["roll"] = roll1;
    forearmDoc["yaw"] = pitch1;
    broadcastJson(forearmDoc);

    JsonDocument upperArmDoc;
    upperArmDoc["type"] = "imu";
    upperArmDoc["podId"] = POD_UPPERARM;
    upperArmDoc["pitch"] = drift;
    upperArmDoc["roll"] = roll2;
    upperArmDoc["yaw"] = pitch2;
    broadcastJson(upperArmDoc);

    if (EMG_ENABLED) {
      JsonDocument emgDoc;
      emgDoc["type"] = "emg";
      emgDoc["podId"] = POD_EMG;
      emgDoc["vrms"] = emgRaw / 4095.0; // 12-bit ADC full scale
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
    Serial.printf("State: %-7s | Flex: %5.1f | Drift: %5.1f | EMG: %4d | Vib: %s | Reps: %d\n",
                  stateStr, flexion, drift, emgRaw, motorActive ? "ON " : "OFF", repCount);
  } else {
    Serial.printf("State: %-7s | Flex: %5.1f | Drift: %5.1f | Vib: %s | Reps: %d\n",
                  stateStr, flexion, drift, motorActive ? "ON " : "OFF", repCount);
  }

  delay(20); // 50 Hz loop
}
