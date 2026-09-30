import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Video, VideoOff, ScanFace, Loader2 } from 'lucide-react'
import { usePoseLandmarker } from '@/lib/pose/usePoseLandmarker'
import { isArmVisible, type Side } from '@/lib/pose/poseMetrics'
import { drawPoseSkeleton } from '@/lib/pose/drawPoseSkeleton'

export function CameraViewport({
  children,
  fallbackSkeleton,
  monitoredSide = 'right',
  faultActive = false,
  onWorldLandmarks,
  poseDetectionEnabled = true,
}: {
  /** Always-rendered overlay content (fault badge, exercise title chip, …). */
  children?: ReactNode
  /** Simulated skeleton shown only when there's no real camera to detect from. */
  fallbackSkeleton?: ReactNode
  monitoredSide?: Side
  /** Whether the curling arm should be drawn in the fault color — driven by the caller's own real fault signal (e.g. the hub's upper-arm drift detection), not computed from vision here. */
  faultActive?: boolean
  /**
   * Fired every detected frame with the raw MediaPipe Pose WORLD landmarks —
   * `.worldLandmarks[0]`, not the image-space `.landmarks[0]` used for the
   * on-screen skeleton — as a plain [x, y, z] array per landmark, or null
   * while no person is detected. This is the exact input shape the trained
   * bicep-curl classifier expects (see ml/src/preprocessing/landmarks.py); a
   * caller buffers these per-rep and posts them to the vision model API.
   */
  onWorldLandmarks?: (landmarks: number[][] | null) => void
  /** False skips camera access and MediaPipe entirely — used to test other input sources (e.g. a real wearable) in isolation. */
  poseDetectionEnabled?: boolean
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [cameraOk, setCameraOk] = useState<boolean | null>(null)
  const [personDetected, setPersonDetected] = useState(false)
  const { status: poseStatus, error: poseError, detectForVideo } = usePoseLandmarker(poseDetectionEnabled)

  useEffect(() => {
    if (!poseDetectionEnabled) return
    let stream: MediaStream | null = null
    let cancelled = false

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', aspectRatio: 16 / 9 },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream
        }
        setCameraOk(true)
      } catch {
        if (!cancelled) setCameraOk(false)
      }
    }

    start()
    return () => {
      cancelled = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [poseDetectionEnabled])

  // Real detection loop: only runs once we have both a live camera frame and
  // a loaded model. Draws directly to canvas (not React state) so a ~30fps
  // skeleton doesn't force React re-renders; only personDetected (throttled
  // by nothing but React's own state-change bailout) touches state here.
  useEffect(() => {
    if (!cameraOk || poseStatus !== 'ready') {
      onWorldLandmarks?.(null)
      return
    }

    const video = videoRef.current
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!video || !canvas || !container) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let rafId: number

    function resizeCanvas() {
      const dpr = window.devicePixelRatio || 1
      const { clientWidth, clientHeight } = container!
      canvas!.width = clientWidth * dpr
      canvas!.height = clientHeight * dpr
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const resizeObserver = new ResizeObserver(resizeCanvas)
    resizeObserver.observe(container)
    resizeCanvas()

    function loop() {
      if (video!.readyState >= 2) {
        const result = detectForVideo(video!, performance.now())
        const landmarks = result?.landmarks?.[0] ?? null
        const cssWidth = container!.clientWidth
        const cssHeight = container!.clientHeight

        if (landmarks) {
          drawPoseSkeleton(ctx!, landmarks, { width: cssWidth, height: cssHeight, monitoredSide, faultActive })
          setPersonDetected(isArmVisible(landmarks, monitoredSide))

          const worldLandmarks = result?.worldLandmarks?.[0] ?? null
          onWorldLandmarks?.(worldLandmarks ? worldLandmarks.map((lm) => [lm.x, lm.y, lm.z]) : null)
        } else {
          ctx!.clearRect(0, 0, cssWidth, cssHeight)
          setPersonDetected(false)
          onWorldLandmarks?.(null)
        }
      }
      rafId = requestAnimationFrame(loop)
    }

    rafId = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(rafId)
      resizeObserver.disconnect()
      onWorldLandmarks?.(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOk, poseStatus, monitoredSide, faultActive])

  const showRealSkeleton = cameraOk && poseStatus === 'ready'

  return (
    <div ref={containerRef} className="relative aspect-video w-full overflow-hidden rounded-2xl bg-black">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={`h-full w-full object-cover ${cameraOk ? 'opacity-100' : 'opacity-0'}`}
      />

      {cameraOk && <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />}

      {cameraOk && poseStatus === 'loading' && (
        <div className="absolute top-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/40 px-3 py-1.5 backdrop-blur-sm">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
          <p className="text-xs text-ink-faint">Loading pose model…</p>
        </div>
      )}

      {cameraOk && poseStatus === 'unavailable' && (
        <div className="absolute top-3 left-1/2 flex max-w-[90%] -translate-x-1/2 flex-col items-center gap-1 rounded-xl bg-black/60 px-3 py-2 text-center backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <VideoOff className="h-3.5 w-3.5 flex-shrink-0 text-amber" />
            <p className="text-xs text-ink-faint">Pose model unavailable — camera feed only</p>
          </div>
          {poseError && (
            <p className="text-[10px] text-ink-faint/70">
              {poseError} — try re-running <code>npm install</code> in frontend/ (this vendors the MediaPipe WASM
              runtime into public/mediapipe/wasm on postinstall).
            </p>
          )}
        </div>
      )}

      {showRealSkeleton && !personDetected && (
        <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/40 px-3 py-1.5 backdrop-blur-sm">
          <ScanFace className="h-3.5 w-3.5 text-ink-faint" />
          <p className="text-xs text-ink-faint">Make sure your shoulder, elbow and wrist are all in frame</p>
        </div>
      )}

      {!cameraOk && (
        <div className="absolute inset-0 bg-gradient-to-b from-slate-900 via-slate-950 to-black">
          <div
            className="absolute inset-0 opacity-[0.07]"
            style={{
              backgroundImage:
                'linear-gradient(90deg, #38bdf8 1px, transparent 1px), linear-gradient(0deg, #38bdf8 1px, transparent 1px)',
              backgroundSize: '32px 32px',
            }}
          />
          <div className="absolute top-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/40 px-3 py-1.5 backdrop-blur-sm">
            <VideoOff className="h-3.5 w-3.5 text-ink-faint" />
            <p className="text-xs text-ink-faint">
              {!poseDetectionEnabled
                ? 'MediaPipe disabled — testing with wearable sensor data only'
                : cameraOk === null
                  ? 'Requesting camera access…'
                  : 'Camera unavailable — showing simulated feed'}
            </p>
          </div>
          {fallbackSkeleton}
        </div>
      )}

      <div className="absolute left-4 top-4 flex items-center gap-1.5 rounded-full bg-black/50 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
        <Video className={`h-3 w-3 ${showRealSkeleton ? 'text-crimson' : 'text-ink-faint'}`} />
        {showRealSkeleton
          ? 'REC · MediaPipe Pose (live)'
          : poseDetectionEnabled
            ? 'REC · MediaPipe Pose (simulated)'
            : 'MediaPipe disabled'}
      </div>

      {children}
    </div>
  )
}
