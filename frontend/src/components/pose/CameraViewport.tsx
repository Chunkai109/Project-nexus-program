import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Video, VideoOff, ScanFace, Loader2 } from 'lucide-react'
import { usePoseLandmarker } from '@/lib/pose/usePoseLandmarker'
import { computeKneeReading, type Side } from '@/lib/pose/poseMetrics'
import { drawPoseSkeleton } from '@/lib/pose/drawPoseSkeleton'

export interface VisionReading {
  flexionDeg: number
  valgusDeg: number
  faultActive: boolean
}

const METRICS_EMIT_INTERVAL_MS = 90

export function CameraViewport({
  children,
  fallbackSkeleton,
  monitoredSide = 'right',
  faultThresholdDeg = 8,
  onVisionMetrics,
}: {
  /** Always-rendered overlay content (fault badge, exercise title chip, …). */
  children?: ReactNode
  /** Simulated skeleton shown only when there's no real camera to detect from. */
  fallbackSkeleton?: ReactNode
  monitoredSide?: Side
  faultThresholdDeg?: number
  onVisionMetrics?: (reading: VisionReading | null) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [cameraOk, setCameraOk] = useState<boolean | null>(null)
  const [personDetected, setPersonDetected] = useState(false)
  const { status: poseStatus, detectForVideo } = usePoseLandmarker()

  useEffect(() => {
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
  }, [])

  // Real detection loop: only runs once we have both a live camera frame and
  // a loaded model. Draws directly to canvas (not React state) so a ~30fps
  // skeleton doesn't force React re-renders; only the throttled metrics
  // callback touches React state, and only in the parent.
  useEffect(() => {
    if (!cameraOk || poseStatus !== 'ready') {
      onVisionMetrics?.(null)
      return
    }

    const video = videoRef.current
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!video || !canvas || !container) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let rafId: number
    let lastEmit = 0

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
          drawPoseSkeleton(ctx!, landmarks, {
            width: cssWidth,
            height: cssHeight,
            monitoredSide,
            faultActive: false,
          })
          const reading = computeKneeReading(landmarks, monitoredSide)
          setPersonDetected(!!reading)

          const now = performance.now()
          if (reading && now - lastEmit > METRICS_EMIT_INTERVAL_MS) {
            lastEmit = now
            const faultActive = reading.valgusDeg > faultThresholdDeg
            // Redraw once more with the real fault color now that we know it.
            drawPoseSkeleton(ctx!, landmarks, { width: cssWidth, height: cssHeight, monitoredSide, faultActive })
            onVisionMetrics?.({ ...reading, faultActive })
          } else if (!reading) {
            onVisionMetrics?.(null)
          }
        } else {
          ctx!.clearRect(0, 0, cssWidth, cssHeight)
          setPersonDetected(false)
          onVisionMetrics?.(null)
        }
      }
      rafId = requestAnimationFrame(loop)
    }

    rafId = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(rafId)
      resizeObserver.disconnect()
      onVisionMetrics?.(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOk, poseStatus, monitoredSide, faultThresholdDeg])

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
          <Loader2 className="h-3.5 w-3.5 animate-spin text-electric" />
          <p className="text-xs text-ink-faint">Loading pose model…</p>
        </div>
      )}

      {cameraOk && poseStatus === 'unavailable' && (
        <div className="absolute top-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/40 px-3 py-1.5 backdrop-blur-sm">
          <VideoOff className="h-3.5 w-3.5 text-amber" />
          <p className="text-xs text-ink-faint">Pose model unavailable — camera feed only</p>
        </div>
      )}

      {showRealSkeleton && !personDetected && (
        <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/40 px-3 py-1.5 backdrop-blur-sm">
          <ScanFace className="h-3.5 w-3.5 text-ink-faint" />
          <p className="text-xs text-ink-faint">Step back so your hips, knees and ankles are all in frame</p>
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
              {cameraOk === null ? 'Requesting camera access…' : 'Camera unavailable — showing simulated feed'}
            </p>
          </div>
          {fallbackSkeleton}
        </div>
      )}

      <div className="absolute left-4 top-4 flex items-center gap-1.5 rounded-full bg-black/50 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
        <Video className={`h-3 w-3 ${showRealSkeleton ? 'text-crimson' : 'text-ink-faint'}`} />
        {showRealSkeleton ? 'REC · MediaPipe Pose (live)' : 'REC · MediaPipe Pose (simulated)'}
      </div>

      {children}
    </div>
  )
}
