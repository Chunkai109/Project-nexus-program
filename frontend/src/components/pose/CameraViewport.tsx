import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Video, VideoOff } from 'lucide-react'

export function CameraViewport({ children }: { children: ReactNode }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [cameraOk, setCameraOk] = useState<boolean | null>(null)

  useEffect(() => {
    let stream: MediaStream | null = null
    let cancelled = false

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
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

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-black">
      <video ref={videoRef} autoPlay playsInline muted className={`h-full w-full object-cover ${cameraOk ? 'opacity-100' : 'opacity-0'}`} />

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
        </div>
      )}

      <div className="absolute left-4 top-4 flex items-center gap-1.5 rounded-full bg-black/50 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
        <Video className="h-3 w-3 text-crimson" />
        REC · MediaPipe Pose (33-landmark)
      </div>

      {children}
    </div>
  )
}
