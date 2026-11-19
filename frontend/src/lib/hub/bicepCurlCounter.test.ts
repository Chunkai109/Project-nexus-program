import { describe, expect, it } from 'vitest'
import { BicepCurlCounter, DEFAULT_DRIFT_TOLERANCE, type BicepCurlCounterResult } from './bicepCurlCounter'

/** Feeds one flex + drift sample pair, the way HubProvider does, and returns the latest result. */
function feed(counter: BicepCurlCounter, flex: number, drift = 0): BicepCurlCounterResult {
  counter.updateFlex(flex)
  return counter.updateDrift(drift)!
}

/** A counter past its ~1 s settling window, with the drift baseline at 0°. */
function settled(): BicepCurlCounter {
  const counter = new BicepCurlCounter()
  for (let i = 0; i < 60; i++) feed(counter, 0, 0)
  return counter
}

/** One curl: straight arm, up to `peak`, back to straight, in 5° steps. `driftAt` gives drift per angle. */
function curl(counter: BicepCurlCounter, peak = 135, driftAt: (flex: number) => number = () => 0): BicepCurlCounterResult {
  let last = feed(counter, 0, driftAt(0))
  for (let a = 0; a <= peak; a += 5) last = feed(counter, a, driftAt(a))
  for (let a = peak; a >= 0; a -= 5) last = feed(counter, a, driftAt(a))
  return last
}

describe('BicepCurlCounter', () => {
  it('returns nothing until both a flex and a drift reading have arrived', () => {
    const counter = new BicepCurlCounter()
    expect(counter.updateFlex(10)).toBeNull()
    expect(counter.updateDrift(0)).not.toBeNull()
  })

  it('does not count while the drift baseline is still settling', () => {
    // 1 s at 50 Hz: a fast rep inside the settling window must not count.
    const counter = new BicepCurlCounter()
    let result = feed(counter, 0)
    for (const a of [40, 95, 135, 60, 10, 0]) result = feed(counter, a)
    expect(result.isBaselineLocked).toBe(false)
    expect(result.repCount).toBe(0)
  })

  it('counts a full clean curl once', () => {
    const counter = settled()
    expect(curl(counter).repCount).toBe(1)
    expect(curl(counter).repCount).toBe(2)
  })

  it('does not count a half curl that never reaches the top', () => {
    const counter = settled()
    expect(curl(counter, 60).repCount).toBe(0)
  })

  it('counts a rep that reaches the top even if it wobbles on the way down', () => {
    const counter = settled()
    for (const a of [0, 40, 95, 135, 60, 30, 45, 25, 10]) feed(counter, a)
    expect(feed(counter, 0).repCount).toBe(1)
  })

  it(`does not count a rep that reaches the bottom with drift over the ${DEFAULT_DRIFT_TOLERANCE}° default`, () => {
    const counter = settled()
    const over = DEFAULT_DRIFT_TOLERANCE + 1
    feed(counter, 40, 0)
    feed(counter, 95, 0)
    for (const a of [135, 60, 30]) feed(counter, a, over)
    const result = feed(counter, 10, over) // arm straight again, still drifted
    expect(result.formCheatDetected).toBe(true)
    expect(result.repCount).toBe(0)
  })

  it('counts a rep whose drift stays just under the limit', () => {
    const counter = settled()
    const result = curl(counter, 135, () => DEFAULT_DRIFT_TOLERANCE - 1)
    expect(result.formCheatDetected).toBe(false)
    expect(result.repCount).toBe(1)
  })

  it('clears the drift fault as soon as drift settles (not latched)', () => {
    const counter = settled()
    feed(counter, 40, 0)
    expect(feed(counter, 60, 30).formCheatDetected).toBe(true)
    expect(feed(counter, 80, 2).formCheatDetected).toBe(false)
  })

  it("uses the plan's own drift tolerance when set", () => {
    const counter = settled()
    counter.setDriftTolerance(30)
    expect(curl(counter, 135, () => 25).repCount).toBe(1)
  })
})
