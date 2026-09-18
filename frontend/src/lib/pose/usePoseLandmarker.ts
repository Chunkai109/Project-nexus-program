import { useEffect, useRef, useState } from 'react'
import { FilesetResolver, PoseLandmarker, type PoseLandmarkerResult } from '@mediapipe/tasks-vision'

// Served from public/mediapipe/wasm (vendored by scripts/copy-mediapipe-wasm.mjs
// on postinstall) instead of the jsdelivr CDN the official docs point at, so
// this keeps working behind restrictive network policies — sandboxes,
// hospital networks — that block third-party CDNs but allow same-origin assets.
const WASM_BASE_PATH = '/mediapipe/wasm'
const MODEL_ASSET_PATH =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'

export type PoseLandmarkerStatus = 'loading' | 'ready' | 'unavailable'

export function usePoseLandmarker() {
  const [status, setStatus] = useState<PoseLandmarkerStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const landmarkerRef = useRef<PoseLandmarker | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const vision = await FilesetResolver.forVisionTasks(WASM_BASE_PATH)

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
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setStatus('unavailable')
      }
    }

    load()
    return () => {
      cancelled = true
      landmarkerRef.current?.close()
      landmarkerRef.current = null
    }
  }, [])

  function detectForVideo(video: HTMLVideoElement, timestampMs: number): PoseLandmarkerResult | null {
    if (!landmarkerRef.current) return null
    return landmarkerRef.current.detectForVideo(video, timestampMs)
  }

  return { status, error, detectForVideo }
}
