#include <Wire.h>
#include <math.h>

// ---------------------------------------------------------------------------
// Isolated test: dual-MPU6050 rep counter only.
//
// No WiFi, no WebSockets, no ArduinoJson, no EMG sensor, no vibration motor
// — just the two IMUs driving the same rep-counting state machine as
// smartphysio_hub.ino, so it can be verified on its own hardware (and
// without the WebSockets library) before wiring the rest back in.
//
// Only depends on Wire.h/math.h, both built into the ESP32 core, so this
// compiles even while the WebSockets library issue on the main sketch is
// still being sorted out.
// ---------------------------------------------------------------------------

#define I2C_SDA 21
#define I2C_SCL 22

// MPU-6050 Addresses
#define MPU1_ADDR 0x68  // Sensor 1: Forearm (Flexion) -> AD0 to GND
#define MPU2_ADDR 0x69  // Sensor 2: Upper Arm (Drift)  -> AD0 to 3.3V

#define PWR_MGMT_1   0x6B
#define ACCEL_XOUT_H 0x3B

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

  Wire.begin(I2C_SDA, I2C_SCL);
  Wire.setClock(400000);

  Serial.println("\n--- Rep Counter Test (Dual MPU6050 only) ---");

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

  prevTime = micros();
  Serial.println("System Ready! Let your arm hang down naturally.\n");
}

void loop() {
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
  float flexion = 90 - roll1; // Sensor 1
  float drift   = roll2 - 90; // Sensor 2

  // 4. Baseline Lock for Upper Arm Drift
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

  // 5. Rep State Machine
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

  // Serial Monitor Output
  Serial.printf("State: %-7s | Flex: %5.1f | Drift: %5.1f | Reps: %d\n",
                stateStr, flexion, drift, repCount);

  delay(20); // 50 Hz loop
}
