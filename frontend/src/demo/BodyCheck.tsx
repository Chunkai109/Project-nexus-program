import { Suspense, useCallback, useEffect, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { BodyModel3D, type BodyMarker3D } from '@/components/body/BodyModel3D'
import { MannequinModel } from '@/components/body/MannequinModel'
import { poseExtra, poseRig, type Rig } from '@/components/body/rig'
import { useTheme } from '@/lib/ThemeContext'
import type { BodyRegion } from '@/lib/bodyRegion'
import { MUSCLE_GROUPS } from '@/lib/muscles'

/**
 * Developer check page for the 3D body (/demo/body). Not linked from the app.
 * It sits outside the data and hub providers: it reads and writes nothing.
 * URL options: ?elbow=90&drift=0&region=upper&mode=editor&knee=0&shoulder=0&fault=1&muscles=1&pods=1&sel=right-elbow&theme=dark
 */

const MUSCLE_IDS = MUSCLE_GROUPS.flatMap((g) => g.muscles.map((m) => m.id))

function ExtraPose({ elbow, knee, shoulder }: { elbow: number; knee: number; shoulder: number }) {
  const invalidate = useThree((s) => s.invalidate)
  const [rig, setRig] = useState<Rig | null>(null)
  const onRig = useCallback((r: Rig) => setRig(r), [])
  useEffect(() => {
    if (!rig) return
    poseRig(rig, elbow, 0)
    poseExtra(rig, knee, shoulder)
    invalidate()
  }, [rig, elbow, knee, shoulder, invalidate])
  return <MannequinModel bodyColor="#d9d3c9" jointColor="#b8b0a3" onRig={onRig} />
}

export function BodyCheck() {
  const q = new URLSearchParams(window.location.search)
  const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d)
  const { theme, toggleTheme } = useTheme()
  const wantDark = q.get('theme') === 'dark'
  useEffect(() => {
    if ((theme === 'dark') !== wantDark) toggleTheme()
  }, [theme, wantDark, toggleTheme])
  const [region, setRegion] = useState<BodyRegion>((q.get('region') as BodyRegion) ?? 'upper')
  const [selected, setSelected] = useState<string | null>(q.get('sel'))
  const mode = (q.get('mode') as 'editor' | 'setup' | 'live') ?? 'editor'
  const knee = num('knee', 0)
  const shoulder = num('shoulder', 0)

  const markers: BodyMarker3D[] = []
  if (q.get('joints') !== '0' && mode === 'editor')
    for (const id of ['right-elbow', 'left-elbow', 'right-shoulder', 'left-shoulder', 'right-hip', 'left-hip', 'right-knee', 'left-knee'])
      markers.push({ id, kind: 'joint', label: id, selectable: id === 'right-elbow' })
  if (q.get('muscles') === '1')
    for (const id of MUSCLE_IDS) markers.push({ id, kind: 'muscle', label: id, selectable: q.get('musel') === '1' || id === 'right-biceps-brachii' })
  if (q.get('pods') === '1') {
    markers.push({ id: 'pod-1', kind: 'pod', label: 'Pod 1', selectable: true, status: 'strong' })
    markers.push({ id: 'pod-2', kind: 'pod', label: 'Pod 2', selectable: true, status: 'weak' })
    markers.push({ id: 'pod-3', kind: 'pod', label: 'Pod 3', selectable: true, status: 'offline' })
    markers.push({ id: 'pod-15', kind: 'pod', label: 'Motor 1', selectable: true, status: 'strong' })
  }

  if (q.get('raw') === '1') {
    const cams: Record<string, [number, number, number, number, number, number]> = {
      front: [0, 1, 4.3, 0, 0.9, 0],
      side: [-4.3, 1, 0.2, 0, 0.9, 0],
      arm: [-1.9, 1.25, 0.9, -0.2, 1.2, 0.1],
      armfront: [-0.2, 1.25, 1.9, -0.2, 1.2, 0],
      leg: [-2.6, 0.6, 0.6, 0, 0.5, 0],
    }
    const c = cams[q.get('view') ?? 'front'] ?? cams.front
    return (
      <div className="h-screen w-screen bg-canvas" data-testid="body-check">
        <Canvas frameloop="demand" camera={{ fov: 30, position: [c[0], c[1], c[2]] }} onCreated={({ camera }) => camera.lookAt(c[3], c[4], c[5])}>
          <hemisphereLight args={['#ffffff', '#8a8378', 0.95]} />
          <directionalLight position={[-2.5, 3.5, 2.5]} intensity={1.15} />
          <Suspense fallback={null}>
            <ExtraPose elbow={num('elbow', 0)} knee={knee} shoulder={shoulder} />
          </Suspense>
        </Canvas>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-canvas p-4 text-ink" data-testid="body-check">
      <div className="mb-2 flex gap-2">
        {(['upper', 'lower', 'core', 'full'] as const).map((r) => (
          <button key={r} type="button" onClick={() => setRegion(r)} className="rounded-full bg-surface px-3 py-1 text-[14px]" aria-pressed={region === r}>
            {r}
          </button>
        ))}
        <span data-testid="selected">{selected ?? 'none'}</span>
      </div>
      <div style={{ width: num('w', 560) }} className="rounded-2xl bg-surface">
        <BodyModel3D
          mode={mode}
          bodyRegion={region}
          markers={markers}
          selected={selected}
          onSelect={setSelected}
          elbowAngleDeg={num('elbow', 0)}
          upperArmDriftDeg={num('drift', 0)}
          driftFault={q.get('fault') === '1'}
          targetRange={q.get('range') ? { min: Number(q.get('range')!.split('-')[0]), max: Number(q.get('range')!.split('-')[1]) } : undefined}
          showPods={q.get('pods') === '1'}
          height={num('h', 560)}
        />
      </div>
    </div>
  )
}
