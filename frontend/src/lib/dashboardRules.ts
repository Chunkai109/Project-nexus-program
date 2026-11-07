/**
 * Rules the physio dashboard uses to judge progress. These are PLACEHOLDERS
 * until a physiotherapist confirms them, and the dashboard says so on screen.
 * They live in one object so a future physio Settings screen can edit them.
 */
export interface DashboardRules {
  /** AI verdicts that count as a good-form rep. */
  goodFormVerdicts: string[]
  /** A patient "needs attention" if their latest session hits any of these. */
  needsAttention: {
    goodFormBelowPct: number
    goodFormDropPts: number
    driftFaultsAtLeast: number
  }
  /** A patient is "inactive" after this many days with no session. */
  inactiveAfterDays: number
}

export const PLACEHOLDER_RULES: DashboardRules = {
  goodFormVerdicts: ['Perfect'],
  needsAttention: {
    goodFormBelowPct: 60,
    goodFormDropPts: 10,
    driftFaultsAtLeast: 3,
  },
  inactiveAfterDays: 7,
}

/** True until a physio signs the rules off; drives the "placeholder rules" notes. */
export const RULES_ARE_PLACEHOLDERS = true
