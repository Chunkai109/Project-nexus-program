/**
 * Tiny deterministic PRNG utilities shared by every "dummy data derived
 * from an id" generator in this app (dummyMedicalProfile.ts,
 * dummySessionHistory.ts) -- same id always produces the same output,
 * different ids produce different-looking output, with no state to
 * persist anywhere.
 */

/** Same string-hash approach as hashColor() in formatRelativeTime.ts, kept separate since callers here need a full PRNG stream (several distinct picks), not one hue value. */
export function hashSeed(input: string): number {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash) || 1
}

/** mulberry32 — tiny deterministic PRNG, seeded once so every subsequent draw is reproducible from just that seed. */
export function mulberry32(seed: number): () => number {
  let a = seed
  return function next() {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
