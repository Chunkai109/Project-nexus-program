import { describe, expect, it } from 'vitest'
import { aiClassOf, sessionStats, verdictCounts } from './sessionStats'
import type { RepSample, SessionRecord } from '@/types'

function rep(n: number, angle: number, aiComment?: string, faultActive = false): RepSample {
  return { rep: n, angle, emgLeft: 0, emgRight: 0, faultActive, ...(aiComment ? { aiComment } : {}) }
}

function session(reps: RepSample[]): SessionRecord {
  return {
    id: 'test-session',
    patientId: 'test-patient',
    patientName: 'Test patient',
    exerciseId: 'bicep-curl',
    exerciseTitle: 'Bicep Curl',
    completedAt: 0,
    durationSec: 60,
    targetMin: 100,
    targetMax: 135,
    reps,
  }
}

describe('aiClassOf', () => {
  it('reads the class from the start of the saved AI comment', () => {
    expect(aiClassOf(rep(1, 120, 'Perfect (92% good form) — fused vision and IMU'))).toBe('Perfect')
    expect(aiClassOf(rep(1, 120, 'Swing (10% good form)'))).toBe('Swing')
  })

  it('returns null when the AI gave no class', () => {
    expect(aiClassOf(rep(1, 120))).toBeNull()
    expect(aiClassOf(rep(1, 120, 'no_exercise_detected — little or no arm movement'))).toBeNull()
    expect(aiClassOf(rep(1, 120, '   '))).toBeNull()
  })
})

describe('sessionStats', () => {
  it('works out good form out of scored reps only, not all reps', () => {
    const stats = sessionStats(
      session([
        rep(1, 120, 'Perfect (90% good form)'),
        rep(2, 110, 'Drag (20% good form)'),
        rep(3, 125, 'Perfect (80% good form)'),
        rep(4, 90), // not scored by the AI
      ]),
    )
    expect(stats.totalReps).toBe(4)
    expect(stats.aiScored).toBe(3)
    expect(stats.unscored).toBe(1)
    expect(stats.goodForm).toBe(2)
    expect(stats.goodFormPct).toBe(67)
  })

  it('counts a rep at the edge of the target range as in range', () => {
    const stats = sessionStats(session([rep(1, 100), rep(2, 135), rep(3, 99), rep(4, 136)]))
    expect(stats.inRange).toBe(2)
    expect(stats.inRangePct).toBe(50)
  })

  it('counts drift faults', () => {
    const stats = sessionStats(session([rep(1, 120, undefined, true), rep(2, 120), rep(3, 120, undefined, true)]))
    expect(stats.driftFaults).toBe(2)
  })

  it('gives null percentages, not 0 %, when there is nothing to judge', () => {
    const stats = sessionStats(session([]))
    expect(stats.goodFormPct).toBeNull()
    expect(stats.inRangePct).toBeNull()
    expect(sessionStats(session([rep(1, 120)])).goodFormPct).toBeNull()
  })
})

describe('verdictCounts', () => {
  it('counts each class and the reps with no verdict', () => {
    const { counts, unscored } = verdictCounts(session([rep(1, 120, 'Perfect'), rep(2, 120, 'Swing'), rep(3, 120, 'Swing'), rep(4, 120)]))
    expect(counts.Perfect).toBe(1)
    expect(counts.Swing).toBe(2)
    expect(counts.Half).toBe(0)
    expect(unscored).toBe(1)
  })
})
