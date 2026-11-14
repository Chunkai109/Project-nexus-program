#include <Wire.h>
#include <math.h>
#include <WiFi.h>
#include <WebSocketsServer.h>
#include <ArduinoJson.h>

// ===========================================================================
// SmartPhysio hub: two MPU-6050s (forearm flexion, upper-arm drift), a
// Sichiray dry-electrode sEMG sensor on the bicep, and one vibration motor.
// Streams flexion, drift and the filtered EMG envelope to the app over its
// own WiFi network + WebSocket, and pulses the motor when the app asks.
//
// IMU maths is the original hub code (flexion = 90 - roll1, drift =
// roll2 - 90), confirmed working on the rig. EMG follows the team's
// "Filtered Sensor Reader (Dual MPU + Sichiray EMG)" sketch (high-pass ->
// 50 Hz notch -> RMS -> smoothing). This file adds the WiFi /
// WebSocket link and the motor around it.
// ===========================================================================

#define I2C_SDA 21
#define I2C_SCL 22

// Hardware Peripheral Pins
#define EMG_PIN            34  // Analog pin for Sichiray EMG signal (ADC1; ADC2 can't be used while WiFi is on)
#define VIB_MOTOR_FORM_PIN 27  // Digital output — single motor strapped on the bicep, pulses on correct form

// MPU-6050 Addresses
#define MPU1_ADDR 0x68  // Sensor 1: Forearm   -> AD0 to GND
#define MPU2_ADDR 0x69  // Sensor 2: Upper Arm -> AD0 to 3.3V

#define PWR_MGMT_1   0x6B
#define ACCEL_XOUT_H 0x3B

// ---------------------------------------------------------------------------
// Shared types — defined before every function in this file. Arduino's
// auto-generated function prototypes are hoisted above all of them, so any
// type used in a function signature must already be declared here.
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
// SmartPhysio app link — this board hosts its own WiFi access point and a
// WebSocket server, so the app connects to it directly with no router.
// Message shapes match frontend/src/lib/hub/protocol.ts.
// ---------------------------------------------------------------------------
const char *AP_SSID = "SmartPhysio-Hub";
const char *AP_PASSWORD = "physio123";  // WPA2 requires 8+ characters
constexpr uint16_t WS_PORT = 81;

// Which pod slot each sensor reports as in the app.
constexpr uint8_t POD_EMG      = 1;  // Bicep sEMG envelope
constexpr uint8_t POD_FOREARM  = 2;  // Sensor 1 — flexion
constexpr uint8_t POD_UPPERARM = 3;  // Sensor 2 — drift

// Pod ID the app addresses "haptic" commands to. Any haptic command pulses
// the one motor. Kept well above the sensor pods (1-3) and the app's
// virtual joint/muscle ids (up to 14) so it can never collide with them.
constexpr uint8_t POD_HAPTIC_FORM = 15;

constexpr unsigned long STATUS_INTERVAL_MS = 2000;

WebSocketsServer webSocket(WS_PORT);
uint8_t connectedClientCount = 0;
unsigned long lastStatusSentAt = 0;
unsigned long formMotorOffAt = 0;  // millis() deadline for the motor's app-commanded pulse

GyroOffsets calib1, calib2;

// Filtered Orientation Angles — only roll is needed (flexion from Sensor 1, drift from Sensor 2).
float roll1 = 0.0; // Forearm
float roll2 = 0.0; // Upper Arm
const float ALPHA = 0.96;

// Timing. EMG is sampled at 1000 Hz in its own task (see emgTask below);
// the MPUs, the EMG envelope update and the WebSocket output run at 50 Hz
// in loop().
const unsigned long MPU_INTERVAL_US = 20000; // 50 Hz MPU & output
unsigned long prevMpuTime = 0;

// --- Sichiray EMG Filter Variables (sample rate fs = 1000 Hz) ---
// 1. High-Pass Filter (~20 Hz cutoff at 1000 Hz) to remove DC offset & motion drift
float hpPrevRaw = 0.0;
float hpPrevOut = 0.0;
const float HP_ALPHA = 0.888;

// 2. 50 Hz IIR Notch Filter (fs = 1000 Hz, Q = 15) to reject AC mains hum
const float NOTCH_B0 =  0.989643;
const float NOTCH_B1 = -1.882534;
const float NOTCH_B2 =  0.989643;
const float NOTCH_A1 = -1.882534;
const float NOTCH_A2 =  0.979286;
float notchX1 = 0.0, notchX2 = 0.0;
float notchY1 = 0.0, notchY2 = 0.0;

// 3. RMS Accumulation & Envelope Low-Pass Smoothing
// emgSumSquared / emgSampleCount are written by the EMG task and read and
// reset by loop(), so both sides go through emgMux.
double emgSumSquared = 0.0;
int emgSampleCount = 0;
portMUX_TYPE emgMux = portMUX_INITIALIZER_UNLOCKED;
float emgRMS = 0.0;
float emgFiltered = 0.0;
const float EMG_SMOOTH_ALPHA = 0.25; // Lower = smoother (0.15 to 0.40 recommended)

// The app expects EMG as a 0-1 value; it turns that into % effort using the
// patient's own resting and firm readings from the calibration step, so
// this only needs to keep real readings inside 0-1. emgFiltered is an RMS
// in ADC counts. TUNE ON THE RIG: set this a little above the largest
// envelope seen during a firm curl (Serial Monitor "EMG:" value).
const float EMG_FULL_SCALE_RMS = 500.0;

// ---------------------------------------------------------------------------
// WebSocket link
// ---------------------------------------------------------------------------
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
  // One physical motor: any haptic command pulses it, whatever the podId.
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

// ---------------------------------------------------------------------------
// MPU-6050
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Sichiray sEMG
// ---------------------------------------------------------------------------
float filterEMG(float rawSample) {
  // Stage 1: 20 Hz High-Pass Filter (removes 1.5V DC offset & slow movement drift)
  float hpOut = HP_ALPHA * (hpPrevOut + rawSample - hpPrevRaw);
  hpPrevRaw = rawSample;
  hpPrevOut = hpOut;

  // Stage 2: 50 Hz Notch Filter (removes AC power-line interference)
  float notchOut = NOTCH_B0 * hpOut + NOTCH_B1 * notchX1 + NOTCH_B2 * notchX2
                   - NOTCH_A1 * notchY1 - NOTCH_A2 * notchY2;
  notchX2 = notchX1;
  notchX1 = hpOut;
  notchY2 = notchY1;
  notchY1 = notchOut;

  return notchOut;
}

// Samples the EMG at exactly 1000 Hz. The filters above are designed for
// fs = 1000 Hz, and WiFi/WebSocket work in loop() can take more than 1 ms,
// so sampling from loop() would skip samples. This task wakes every 1 ms
// tick (FreeRTOS runs at 1000 Hz on the ESP32 Arduino core), on the same
// core as loop() but at a higher priority.
void emgTask(void *) {
  TickType_t lastWake = xTaskGetTickCount();
  for (;;) {
    vTaskDelayUntil(&lastWake, pdMS_TO_TICKS(1));
    float rawEmg = (float)analogRead(EMG_PIN);
    float cleanEmg = filterEMG(rawEmg);
    portENTER_CRITICAL(&emgMux);
    emgSumSquared += (double)(cleanEmg * cleanEmg);
    emgSampleCount++;
    portEXIT_CRITICAL(&emgMux);
  }
}

// ---------------------------------------------------------------------------
// Setup and loop
// ---------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  while (!Serial) delay(10);

  pinMode(VIB_MOTOR_FORM_PIN, OUTPUT);
  digitalWrite(VIB_MOTOR_FORM_PIN, LOW);

  analogReadResolution(12); // ESP32 ADC: 0 to 4095

  Wire.begin(I2C_SDA, I2C_SCL);
  Wire.setClock(400000);

  Serial.println("\n--- SmartPhysio Hub (Dual MPU + Sichiray EMG + Haptic) ---");

  if (!initSensor(MPU1_ADDR)) Serial.println("Sensor 1 (0x68) NOT detected!");
  if (!initSensor(MPU2_ADDR)) Serial.println("Sensor 2 (0x69) NOT detected!");

  delay(200);
  calibrateGyro(MPU1_ADDR, calib1, "Sensor 1 (Forearm)");
  calibrateGyro(MPU2_ADDR, calib2, "Sensor 2 (Upper Arm)");

  // Pre-seed high-pass filter with initial ADC reading to prevent startup spike
  hpPrevRaw = analogRead(EMG_PIN);

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

  // Start EMG sampling last, once the filter is seeded. Same core as loop()
  // (ARDUINO_RUNNING_CORE), one priority above it.
  xTaskCreatePinnedToCore(emgTask, "emg", 4096, nullptr, 2, nullptr, ARDUINO_RUNNING_CORE);

  prevMpuTime = micros();
  Serial.println("Streaming filtered sensor values...\n");
}

void loop() {
  webSocket.loop();

  // The motor's pulse is switched off on time every pass, not only at 50 Hz.
  bool formVibActive = false;
  if (formMotorOffAt != 0) {
    if (millis() < formMotorOffAt) {
      formVibActive = true;
    } else {
      formMotorOffAt = 0;
    }
  }
  digitalWrite(VIB_MOTOR_FORM_PIN, formVibActive ? HIGH : LOW);

  // 50 Hz: MPU-6050 read, smoothed EMG envelope, output
  unsigned long curTime = micros();
  if (curTime - prevMpuTime < MPU_INTERVAL_US) return;
  float dt = (curTime - prevMpuTime) / 1000000.0;
  prevMpuTime = curTime;

  // Take this window's EMG samples from the EMG task.
  portENTER_CRITICAL(&emgMux);
  double sumSquared = emgSumSquared;
  int sampleCount = emgSampleCount;
  emgSumSquared = 0.0;
  emgSampleCount = 0;
  portEXIT_CRITICAL(&emgMux);

  if (sampleCount > 0) {
    emgRMS = sqrt((float)(sumSquared / sampleCount));
    // Stage 3: Exponential Moving Average to smooth out RMS jitter
    emgFiltered = (EMG_SMOOTH_ALPHA * emgRMS) + ((1.0 - EMG_SMOOTH_ALPHA) * emgFiltered);
  }

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

  // 3. Sensor angle formulas (the original hub code, confirmed working on the rig)
  float flexion = 90 - roll1; // Sensor 1
  float drift   = roll2 - 90; // Sensor 2

  // Stream live values to the app, if it's connected. Rep counting, drift
  // faults and the haptic decision all live in the app; this board only
  // relays readings. The app reads each IMU value from the "pitch" field.
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

    JsonDocument emgDoc;
    emgDoc["type"] = "emg";
    emgDoc["podId"] = POD_EMG;
    emgDoc["vrms"] = min(1.0f, emgFiltered / EMG_FULL_SCALE_RMS);
    broadcastJson(emgDoc);

    unsigned long wsNow = millis();
    if (wsNow - lastStatusSentAt >= STATUS_INTERVAL_MS) {
      lastStatusSentAt = wsNow;
      // Every pod is wired to this board, so it is online whenever the board is.
      // No battery-monitoring circuit yet: 100 is a placeholder.
      const uint8_t statusPods[4] = { POD_EMG, POD_FOREARM, POD_UPPERARM, POD_HAPTIC_FORM };
      for (uint8_t i = 0; i < 4; i++) {
        JsonDocument statusDoc;
        statusDoc["type"] = "status";
        statusDoc["podId"] = statusPods[i];
        statusDoc["battery"] = 100;
        statusDoc["signal"] = "strong";
        broadcastJson(statusDoc);
      }
    }
  }

  // Same line format as the reference sketch, so Serial Monitor recordings match it.
  Serial.printf("Flex: %5.1f | Drift: %5.1f | EMG: %5.1f\n",
                flexion, drift, emgFiltered);
}
