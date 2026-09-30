import { useEffect, useRef, useState } from 'react'
import { FilesetResolver, PoseLandmarker, type PoseLandmarkerResult } from '@mediapipe/tasks-vision'

// Tried in order, as paired (wasm, model) configs. The first config is
// served entirely from public/mediapipe/ (vendored by
// scripts/copy-mediapipe-wasm.mjs on postinstall) — both the WASM runtime
// AND the pose landmarker model file itself, so this can load with ZERO
// network access. That matters for more than "restrictive networks that
// block third-party CDNs": this project's own ESP32 hub creates an
// isolated WiFi access point with no internet route at all once you join
// it (see firmware/README.md) — a patient testing with the real hardware
// has necessarily disconnected from their normal WiFi/internet to do so.
// An earlier version always fetched the model file live from Google
// regardless of the WASM path, which silently broke pose detection for
// exactly that real-hardware case. The second config is the official
// jsdelivr CDN + Google-hosted model URL the MediaPipe docs normally point
// at, tried only as a fallback if the first fails for any reason (e.g.
// postinstall's vendoring step didn't run, got interrupted, or the model
// download failed because there was no internet yet at install time — see
// copy-mediapipe-wasm.mjs's own comment) — this fallback config needs real
// internet access to succeed, same as before this local-model vendoring
// existed.
const MODEL_CONFIGS = [
  { wasmPath: '/mediapipe/wasm', modelPath: '/mediapipe/models/pose_landmarker_lite.task' },
  {
    wasmPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm',
    modelPath:
      'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  },
]

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
      for (const { wasmPath, modelPath } of MODEL_CONFIGS) {
        try {
          const vision = await FilesetResolver.forVisionTasks(wasmPath)

          async function create(delegate: 'GPU' | 'CPU') {
            return PoseLandmarker.createFromOptions(vision, {
              baseOptions: { modelAssetPath: modelPath, delegate },
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
          // Try the next config (if any) — e.g. the vendored local
          // WASM/model files failed to load, fall back to the CDN + live
          // Google-hosted model (which needs real internet access).
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
