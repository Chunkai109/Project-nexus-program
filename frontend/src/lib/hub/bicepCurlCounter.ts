export type CurlRepState = 'down' | 'curling' | 'top'

export interface BicepCurlCounterResult {
  repCount: number
  repState: CurlRepState
  /** True when the in-progress (or just-completed) rep drifted past DRIFT_TOLERANCE from baseline. */
  formCheatDetected: boolean
  /** abs(drift - baselineDrift) as of the last sample. */
  driftError: number
  /** False during the ~1s startup window while the drift baseline is still settling. */
  isBaselineLocked: boolean
}

// Rep-counting thresholds, independent of the firmware — the ESP32 has no
// rep-counting or vibration-trigger logic of its own; see smartphysio_hub.ino.
const START_CURL_LIMIT = 30
const CONTRACTION_LIMIT = 80
const EXTENSION_LIMIT = 20
const DRIFT_TOLERANCE = 15
const SETTLE_SAMPLES = 50

/** Which hub pods carry flex/drift, matching POD_FOREARM/POD_UPPERARM in smartphysio_hub.ino. */
export const CURL_FLEX_POD_ID = 2
export const CURL_DRIFT_POD_ID = 3

const INITIAL_RESULT: BicepCurlCounterResult = {
  repCount: 0,
  repState: 'down',
  formCheatDetected: false,
  driftError: 0,
  isBaselineLocked: false,
}

/**
 * Rep-counting state machine — the sole implementation of it in the whole
 * system. The ESP32 firmware (smartphysio_hub.ino) only streams raw
 * flexion/drift values and has no rep-counting logic of its own; this is
 * where reps actually get counted.
 *
 * Deliberately a plain stateful class rather than a React hook keyed on
 * rendered props: flex and drift arrive as two separate WebSocket messages,
 * and when several arrive within the same JS tick, React 18's automatic
 * batching coalesces them into a single render — silently skipping every
 * intermediate value in between. A threshold-crossing state machine can't
 * tolerate that (a whole rep can vanish between two batched renders), so
 * this steps synchronously inside the hub's own message handler (see
 * HubProvider.tsx) for every sample, in order, with React state only used
 * to publish the latest *result* for display.
 */
export class BicepCurlCounter {
  private repState: CurlRepState = 'down'
  private repCount = 0
  private baselineDrift = 0
  private isBaseSet = false
  private settleCount = 0
  private formCheatDetected = false
  private latestFlex: number | null = null
  private latestDrift: number | null = null

  /** Call whenever the flex pod (CURL_FLEX_POD_ID) reports a new reading. Returns the updated result once a drift reading has also been seen at least once, else null. */
  updateFlex(flex: number): BicepCurlCounterResult | null {
    this.latestFlex = flex
    return this.tryStep()
  }

  /** Call whenever the drift pod (CURL_DRIFT_POD_ID) reports a new reading. Returns the updated result once a flex reading has also been seen at least once, else null. */
  updateDrift(drift: number): BicepCurlCounterResult | null {
    this.latestDrift = drift
    return this.tryStep()
  }

  private tryStep(): BicepCurlCounterResult | null {
    if (this.latestFlex == null || this.latestDrift == null) return null
    return this.step(this.latestFlex, this.latestDrift)
  }

  private step(flex: number, drift: number): BicepCurlCounterResult {
    if (!this.isBaseSet) {
      this.settleCount += 1
      if (this.settleCount > SETTLE_SAMPLES) {
        this.baselineDrift = drift
        this.isBaseSet = true
      }
      return this.snapshot(0)
    }

    const driftError = Math.abs(drift - this.baselineDrift)
    if (driftError > DRIFT_TOLERANCE) {
      this.formCheatDetected = true
    }

    switch (this.repState) {
      case 'down':
        if (flex < EXTENSION_LIMIT) {
          this.baselineDrift = 0.95 * this.baselineDrift + 0.05 * drift
          this.formCheatDetected = false
        }
        if (flex > START_CURL_LIMIT) this.repState = 'curling'
        break

      case 'curling':
        if (flex >= CONTRACTION_LIMIT) this.repState = 'top'
        else if (flex < EXTENSION_LIMIT) this.repState = 'down'
        break

      case 'top':
        if (flex < EXTENSION_LIMIT) {
          if (!this.formCheatDetected) this.repCount += 1
          this.formCheatDetected = false
          this.repState = 'down'
        }
        break
    }

    return this.snapshot(driftError)
  }

  private snapshot(driftError: number): BicepCurlCounterResult {
    return {
      repCount: this.repCount,
      repState: this.repState,
      formCheatDetected: this.formCheatDetected,
      driftError,
      isBaselineLocked: this.isBaseSet,
    }
  }
}

export function createInitialBicepCurlResult(): BicepCurlCounterResult {
  return INITIAL_RESULT
}
