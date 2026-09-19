import { useEffect, useRef, useState } from 'react'
import type { SessionMetrics } from '@/types'

/**
 * Simulates the on-chip sensor pipeline described in the proposal's
 * "Sensor Signal Processing & On-Chip Pipeline" section:
 *  - Multi-node IMU fusion (complementary filter) -> segment pitch/roll used
 *    here to derive a knee flexion angle per rep cycle.
 *  - EMG calibration: %Activation = (Vrms - Vbaseline) / (Vmvc - Vbaseline) * 100
 * There is no ESP32/BLE link connected in this draft, so the waveform is
 * generated locally at the same cadence the real GATT notification stream
 * would arrive at (~20 Hz), keeping every downstream widget wire-compatible
 * with a live device.
 */
const TICK_MS = 50
const V_BASELINE = 0.08
const V_MVC = 1.0

function emgActivation(vrms: number): number {
  const pct = ((vrms - V_BASELINE) / (V_MVC - V_BASELINE)) * 100
  return Math.max(0, Math.min(100, pct))
}

export function useSensorStream(active: boolean, targetMin: number | null, targetMax: number | null) {
  const [metrics, setMetrics] = useState<SessionMetrics>({
    kneeFlexionDeg: targetMin != null && targetMax != null ? (targetMin + targetMax) / 2 : 90,
    targetMin: targetMin ?? 90,
    targetMax: targetMax ?? 110,
    emgLeft: 0,
    emgRight: 0,
    faultActive: false,
    faultLabel: null,
    faultDeg: 0,
    activeHapticPod: null,
    repCount: 0,
    elapsedSec: 0,
  })

  const tRef = useRef(0)
  const repPhaseRef = useRef(0)
  const lastRepEdgeRef = useRef(false)

  useEffect(() => {
    if (!active || targetMin == null || targetMax == null) return

    const start = performance.now()
    const interval = setInterval(() => {
      tRef.current += TICK_MS / 1000
      repPhaseRef.current += 0.045

      const mid = (targetMin + targetMax) / 2
      const amp = (targetMax - targetMin) / 2
      const cycle = Math.sin(repPhaseRef.current)
      const jitter = (Math.sin(tRef.current * 5.3) + Math.sin(tRef.current * 2.1)) * 1.5

      // Occasional knee-valgus style fault event, more likely near peak flexion.
      const faultRoll = Math.sin(tRef.current * 0.37) > 0.93
      const faultDeg = faultRoll ? 8 + Math.round(Math.sin(tRef.current * 9) * 4 + 4) : 0

      const angle = Math.round(mid + cycle * amp * 0.92 + jitter + (faultRoll ? faultDeg : 0))

      const vrmsLeft = 0.55 + Math.max(0, cycle) * 0.42 + Math.sin(tRef.current * 3) * 0.03
      const vrmsRight = faultRoll
        ? 0.22 + Math.max(0, cycle) * 0.18
        : 0.5 + Math.max(0, cycle) * 0.38 + Math.sin(tRef.current * 2.6) * 0.03

      const risingEdge = cycle > 0.85
      let repCountDelta = 0
      if (risingEdge && !lastRepEdgeRef.current) repCountDelta = 1
      lastRepEdgeRef.current = risingEdge

      setMetrics((prev) => ({
        kneeFlexionDeg: angle,
        targetMin,
        targetMax,
        emgLeft: Math.round(emgActivation(vrmsLeft)),
        emgRight: Math.round(emgActivation(vrmsRight)),
        faultActive: faultRoll,
        faultLabel: faultRoll ? `Knee Valgus Detected (+${faultDeg}° Fault)` : null,
        faultDeg,
        activeHapticPod: faultRoll ? 4 : null,
        repCount: prev.repCount + repCountDelta,
        elapsedSec: Math.floor((performance.now() - start) / 1000),
      }))
    }, TICK_MS)

    return () => clearInterval(interval)
  }, [active, targetMin, targetMax])

  return metrics
}
