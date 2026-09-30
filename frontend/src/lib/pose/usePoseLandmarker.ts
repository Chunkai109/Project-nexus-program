import { useEffect, useRef, useState } from 'react'
import { FilesetResolver, PoseLandmarker, type PoseLandmarkerResult } from '@mediapipe/tasks-vision'

// Tried in order. The first is served from public/mediapipe/wasm (vendored
// by scripts/copy-mediapipe-wasm.mjs on postinstall) instead of a
// third-party CDN, so this keeps working behind restrictive network
// policies — sandboxes, hospital networks — that block third-party CDNs but
// allow same-origin assets. The second is the official jsdelivr CDN docs
// normally point at, tried only as a fallback if the first fails for any
// reason (e.g. postinstall's vendoring step didn't run or got interrupted,
// or node_modules was reused from an install where it silently no-op'd —
// see copy-mediapipe-wasm.mjs's own comment) — the model asset below is
// already fetched from a Google-hosted URL unconditionally either way, so
// this doesn't meaningfully change what external network access the app
// already depends on.
const WASM_PATHS = ['/mediapipe/wasm', 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm']
const MODEL_ASSET_PATH =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'

export type PoseLandmarkerStatus = 'loading' | 'ready' | 'unavailable' | 'disabled'

/** Pass `enabled: false` to skip loading the model entirely (no WASM fetch, no camera-driven inference) — used to test the MPU-only rep counter without MediaPipe running at all. */
export function usePoseLandmarker(enabled = true) {
  const [status, setStatus] = useState<PoseLandmarkerStatus>(enabled ? 'loading' : 'disabled')
  const [error, setError] = useState<string | null>(null)
  const landmarkerRef = useRef<PoseLandmarker | null>(null)

  useEffect(() => {
    if (!enabled) {
      setStatus('disabled')
      return
    }
    let cancelled = false

    async function load() {
      let lastErr: unknown = null
      for (const wasmPath of WASM_PATHS) {
        try {
          const vision = await FilesetResolver.forVisionTasks(wasmPath)

          async function create(delegate: 'GPU' | 'CPU') {
            return PoseLandmarker.createFromOptions(vision, {
              baseOptions: { modelAssetPath: MODEL_ASSET_PATH, delegate },
              runningMode: 'VIDEO',
              numPoses: 1,
            })
          }

          let landmarker: PoseLandmarker
          try {
            landmarker = await create('GPU')
          } catch {
            landmarker = await create('CPU')
          }

          if (cancelled) {
            landmarker.close()
            return
          }
          landmarkerRef.current = landmarker
          setStatus('ready')
          return
        } catch (err) {
          lastErr = err
          // Try the next path (if any) — e.g. the vendored local WASM
          // runtime failed to load, fall back to the CDN.
        }
      }
      if (cancelled) return
      setError(lastErr instanceof Error ? lastErr.message : String(lastErr))
      setStatus('unavailable')
    }

    load()
    return () => {
      cancelled = true
      landmarkerRef.current?.close()
      landmarkerRef.current = null
    }
  }, [enabled])

  function detectForVideo(video: HTMLVideoElement, timestampMs: number): PoseLandmarkerResult | null {
    if (!landmarkerRef.current) return null
    return landmarkerRef.current.detectForVideo(video, timestampMs)
  }

  return { status, error, detectForVideo }
}
