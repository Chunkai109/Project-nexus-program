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
//
// These must track the default Bicep Curl exercise's target corridor
// (targetMin/targetMax in buildDefaultBicepCurlExercise(), AppDataContext.tsx)
// -- START_CURL_LIMIT = targetMin, CONTRACTION_LIMIT = targetMax,
// EXTENSION_LIMIT = targetMin - 10. When the corridor was recalibrated from
// 30-80 to the real rig's actual 150-180 range ("Set bicep curl corridor to
// 150-180" commit), these three constants were left behind at the old
// 30/80/20 values -- since 80 sits well BELOW the real sensor's resting
// (fully-extended) reading once the corridor moved up to 150+, every sample
// after the ~1s baseline-settle window already read above CONTRACTION_LIMIT,
// so repState jumped straight to 'top' and could never drop back below
// EXTENSION_LIMIT (also stale at 20) to complete a rep -- rep counting was
// permanently stuck at 0 no matter how many real curls were performed. Fixed
// by moving these to match the real corridor; if the corridor is ever
// recalibrated again, update these three in the same commit.
const START_CURL_LIMIT = 150
const CONTRACTION_LIMIT = 180
const EXTENSION_LIMIT = 140
const DRIFT_TOLERANCE = 15
const SETTLE_SAMPLES = 50

/** Which hub pods carry flex/drift, matching POD_FOREARM/POD_UPPERARM in smartphysio_hub.ino. */
export const CURL_FLEX_POD_ID = 2
export const CURL_DRIFT_POD_ID = 3

/**
 * The two independent vibration motors, matching POD_HAPTIC_CORRIDOR/
 * POD_HAPTIC_FAULT in smartphysio_hub.ino. Chosen past the sensor pods (1-3)
 * and the frontend's virtual joint/muscle node range (lib/joints.ts,
 * muscles.ts top out at 14) so a haptic command's podId never collides with
 * a real or virtual sensor node.
 */
export const POD_HAPTIC_CORRIDOR = 15
export const POD_HAPTIC_FAULT = 16

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
        // Stays latched in 'top' through any wobble above EXTENSION_LIMIT
        // (including a real, gradual descent that hasn't reached it yet) --
        // only a genuine full extension exits this state. An earlier version
        // fell back to 'curling' as soon as flex dropped below
        // START_CURL_LIMIT, meant as a safety valve for someone releasing
        // partway and never fully extending; in practice, since
        // START_CURL_LIMIT and EXTENSION_LIMIT are only ~10 degrees apart
        // and real sensor samples arrive every ~20ms, an ordinary rep's
        // descent almost always lands a sample inside that band before
        // reaching EXTENSION_LIMIT, so this branch fired on nearly every
        // real rep and silently discarded it (repCount permanently stuck at
        // 0) -- confirmed by simulating a normal gradual descent through the
        // state machine. Removed rather than widened: a real partial release
        // just means the count is credited a little later, once the arm
        // actually reaches full extension, instead of being dropped.
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
