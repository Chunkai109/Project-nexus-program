export type CurlRepState = 'down' | 'curling' | 'top'

export interface BicepCurlCounterResult {
  repCount: number
  repState: CurlRepState
  /** True when the CURRENT sample's drift exceeds DRIFT_TOLERANCE from baseline -- live, not latched (see BicepCurlCounter.step()'s own comment on why an earlier latching version was a bug). */
  formCheatDetected: boolean
  /** abs(drift - baselineDrift) as of the last sample. */
  driftError: number
  /** False during the ~1s startup window while the drift baseline is still settling. */
  isBaselineLocked: boolean
}

// Rep-counting thresholds, independent of the firmware — the ESP32 has no
// rep-counting or vibration-trigger logic of its own; see smartphysio_hub.ino.
//
// Deliberately INDEPENDENT of the exercise's own target corridor
// (targetMin/targetMax in buildDefaultBicepCurlExercise(), AppDataContext.tsx)
// -- an earlier version tied these directly to that corridor (START_CURL_LIMIT
// = targetMin, CONTRACTION_LIMIT = targetMax), which meant recalibrating the
// corridor silently broke rep counting twice: once when the corridor moved to
// 150-180 while these stayed at the old 30/80/20 (rep counting got
// permanently stuck at 0 since the real sensor's resting reading was already
// above the stale CONTRACTION_LIMIT=80), and the 150-180 corridor itself then
// turned out to be wrong too -- a real measured curl on this rig reads 0° at
// full extension and 135° at full contraction, nowhere near 150-180. "Rep
// happened at all" (below) and "hit the prescribed target zone" (the
// exercise's own corridor, checked separately in LiveSession.tsx) are
// different questions and now use different numbers on purpose: these three
// span most of the real measured 0-135 range with margin for natural
// variation, so an ordinary rep gets counted even short of a picture-perfect
// max contraction every time.
const START_CURL_LIMIT = 35
const CONTRACTION_LIMIT = 90
const DRIFT_TOLERANCE = 15
const SETTLE_SAMPLES = 50

/**
 * Below this = arm fully extended at the bottom of a rep, on this rig's real
 * measured 0-135 range. Exported (unlike the other thresholds above) because
 * LiveSession.tsx reuses it for a second, unrelated purpose: marking the
 * start of the AI Form Check's camera-frame buffering window, which now
 * spans "from the moment flexion leaves full extension and starts rising"
 * through "reaches the target corridor" for a single rep, instead of a fixed
 * frame count that could span multiple reps. Sharing this constant (rather
 * than inventing a second one) keeps "what counts as the bottom of a rep"
 * defined in exactly one place.
 */
export const EXTENSION_LIMIT = 20

/** Which hub pods carry flex/drift, matching POD_FOREARM/POD_UPPERARM in smartphysio_hub.ino. */
export const CURL_FLEX_POD_ID = 2
export const CURL_DRIFT_POD_ID = 3

/**
 * The single vibration motor, matching POD_HAPTIC_FORM in
 * smartphysio_hub.ino. Chosen past the sensor pods (1-3) and the frontend's
 * virtual joint/muscle node range (lib/joints.ts, muscles.ts top out at 14)
 * so a haptic command's podId never collides with a real or virtual sensor
 * node. Previously two motors (corridor + fault); down to this one, which
 * pulses only on correct form.
 */
export const POD_HAPTIC_FORM = 15

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

    // Live, not latched: recomputed fresh every sample from the current
    // drift reading alone, so it clears the instant drift settles back
    // under tolerance. An earlier version only ever set this true here and
    // relied on the 'down' case below to clear it -- meaning one brief
    // sensor-noise spike anywhere during a rep's rise latched the fault ON
    // for the rest of that rep (through 'curling' and 'top') even after
    // drift had long since settled back down, well under tolerance. That's
    // a real bug, not a tolerance-tuning issue: raising DRIFT_TOLERANCE
    // made it a little harder to trip in the first place, but did nothing
    // about it never un-triggering mid-rep -- confirmed on real hardware by
    // the fault badge showing "+2° Over Baseline" (well under a 15°
    // tolerance) while still displaying as active.
    const driftError = Math.abs(drift - this.baselineDrift)
    this.formCheatDetected = driftError > DRIFT_TOLERANCE

    switch (this.repState) {
      case 'down':
        if (flex < EXTENSION_LIMIT) {
          this.baselineDrift = 0.95 * this.baselineDrift + 0.05 * drift
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
