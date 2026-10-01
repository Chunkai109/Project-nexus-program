export interface FlexDriftSample {
  flex: number
  drift: number
}

/**
 * Buffers time-aligned flex/drift pairs for the fused vision+IMU model
 * (ensemble/api/server.py's POST /predict) — the model's imu.flex/imu.drift
 * arrays, only. This is the sole real signal fed into that side of the
 * fused call; emg and vib_on are sent as fixed placeholders (see
 * frontend/src/lib/visionModel.ts's predictFusedForm), not derived from
 * anything here.
 *
 * Stepped synchronously inside HubProvider's onImu handler, not from a
 * React effect keyed on rendered pod state — see BicepCurlCounter's own
 * class doc for why that distinction matters (batched React state updates
 * can silently drop samples landing in the same tick).
 *
 * A sample is recorded on every flex or drift update, once both have been
 * seen at least once — mirroring BicepCurlCounter.tryStep()'s identical
 * "step on either update" pattern, so this stays in sync with exactly the
 * same message cadence the rep counter itself already steps on.
 */
export class ImuFlexDriftRecorder {
  private samples: FlexDriftSample[] = []
  private latestFlex: number | null = null
  private latestDrift: number | null = null

  updateFlex(flex: number): void {
    this.latestFlex = flex
    this.tryRecord()
  }

  updateDrift(drift: number): void {
    this.latestDrift = drift
    this.tryRecord()
  }

  private tryRecord(): void {
    if (this.latestFlex === null || this.latestDrift === null) return
    this.samples.push({ flex: this.latestFlex, drift: this.latestDrift })
  }

  /** Returns everything buffered since the last drain, and clears the buffer — call this once per completed rep. */
  drain(): FlexDriftSample[] {
    const result = this.samples
    this.samples = []
    return result
  }
}
