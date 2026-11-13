import { Fragment, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, createPortal, events as pointerEvents, useFrame, useThree, type RootState, type ThreeEvent } from '@react-three/fiber'
import { CameraControls } from '@react-three/drei'
import * as THREE from 'three'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { clsx } from 'clsx'
import { useTheme } from '@/lib/ThemeContext'
import type { BodyRegion } from '@/lib/bodyRegion'
import { MannequinModel } from './MannequinModel'
import { BODY_MODEL_URL, MUSCLES_MODEL_URL, useModel } from './modelLoader'
import { buildRig, findBone, geometryForBones, poseRig, resetRig, type Rig } from './rig'
import type { BoneKey } from './bones'
import { NOT_MEASURED } from './measured'

export type BodyModelMode = 'editor' | 'setup' | 'live'

/** Something drawn on the body: a joint, a muscle area or a sensor pod. */
export interface BodyMarker3D {
  /** Joint id (e.g. "right-elbow"), muscleId (e.g. "right-biceps-brachii") or pod id ("pod-1"). */
  id: string
  kind: 'joint' | 'muscle' | 'pod'
  label: string
  /** False for anything this rig does not measure: drawn grey and not clickable. */
  selectable: boolean
  /** Muscles only: drawn a little stronger (e.g. the rest of the chosen muscle group). */
  emphasised?: boolean
  /** Pods only: live connection status. */
  status?: 'strong' | 'weak' | 'offline'
}

const NO_MARKERS: BodyMarker3D[] = []

const JOINT_BONE: Record<string, BoneKey> = {
  'right-shoulder': 'rightUpperArm',
  'left-shoulder': 'leftUpperArm',
  'right-elbow': 'rightForearm',
  'left-elbow': 'leftForearm',
  'right-hip': 'rightThigh',
  'left-hip': 'leftThigh',
  'right-knee': 'rightShin',
  'left-knee': 'leftShin',
}

/** Where each pod sits, measured on the T-pose arm: along which bone, how far along, and which way it faces. */
const POD_PLACES: Record<string, { from: BoneKey; to: BoneKey; t: number; dir: [number, number, number]; attach: BoneKey }> = {
  'pod-1': { from: 'rightUpperArm', to: 'rightForearm', t: 0.58, dir: [0, 0, 1], attach: 'rightUpperArm' }, // front of the bicep
  'pod-15': { from: 'rightUpperArm', to: 'rightForearm', t: 0.3, dir: [0, 0.55, 0.83], attach: 'rightUpperArm' }, // motor, higher on the bicep
  'pod-3': { from: 'rightUpperArm', to: 'rightForearm', t: 0.86, dir: [0, 0, -1], attach: 'rightUpperArm' }, // back of the arm, near the elbow
  'pod-2': { from: 'rightForearm', to: 'rightHand', t: 0.42, dir: [0, 1, 0], attach: 'rightForearm' }, // outer forearm once the arm hangs down
}

interface View {
  position: [number, number, number]
  target: [number, number, number]
}
/** Camera presets. The figure is 1.8 m tall, faces +Z, and its right arm is on -X. */
const VIEWS: Record<BodyRegion | 'arm' | 'elbow' | 'live', View> = {
  full: { position: [0, 1.0, 4.3], target: [0, 0.9, 0] },
  upper: { position: [-0.5, 1.4, 2.5], target: [-0.1, 1.3, 0] },
  lower: { position: [0, 0.62, 2.45], target: [0, 0.52, 0] },
  core: { position: [0, 1.18, 1.6], target: [0, 1.14, 0] },
  arm: { position: [-1.6, 1.2, 0.8], target: [-0.24, 1.08, 0.03] },
  // Three-quarter view of the right arm, so the target arc is seen face-on.
  elbow: { position: [-1.9, 1.3, 1.35], target: [-0.2, 1.12, 0.12] },
  live: { position: [-1.75, 1.2, 0.8], target: [-0.2, 1.1, 0.16] },
}

const STATUS_WORD = { strong: 'Connected', weak: 'Weak signal', offline: 'Not connected' } as const

function cssColor(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

interface Palette {
  body: string
  joints: string
  accent: string
  good: string
  warn: string
  fault: string
  muted: string
}

/** Stops the given bones' triangles being hidden by the body they sit on. */
function overlayMaterial(color: string, opacity: number) {
  return new THREE.MeshStandardMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    roughness: 0.7,
    depthWrite: opacity >= 1,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    side: THREE.DoubleSide,
  })
}

/** The shaded target arc at the elbow, from targetMin to targetMax. Drawn in the elbow frame, so it follows the upper arm. */
function TargetArc({ range, color }: { range: { min: number; max: number }; color: string }) {
  const geometry = useMemo(() => {
    // In the elbow frame the straight forearm points along -X (the T-pose) and the hinge is the vertical axis.
    const straight = new THREE.Vector3(-1, 0, 0)
    const axis = new THREE.Vector3(0, 1, 0)
    const radius = 0.2
    const steps = Math.max(6, Math.round((range.max - range.min) / 4))
    const points: number[] = [0, 0, 0]
    for (let i = 0; i <= steps; i++) {
      const deg = range.min + ((range.max - range.min) * i) / steps
      const p = straight.clone().applyAxisAngle(axis, THREE.MathUtils.degToRad(deg)).multiplyScalar(radius)
      points.push(p.x, p.y, p.z)
    }
    const index: number[] = []
    for (let i = 1; i <= steps; i++) index.push(0, i, i + 1)
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
    geo.setIndex(index)
    return geo
  }, [range.min, range.max])
  useEffect(() => () => geometry.dispose(), [geometry])
  return (
    <mesh geometry={geometry} renderOrder={3}>
      <meshBasicMaterial color={color} transparent opacity={0.38} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  )
}

/** A see-through forearm that swings between the two ends of the target range (2 s loop). */
function GhostForearm({ range, driftDeg, color }: { range: { min: number; max: number }; driftDeg: number; color: string }) {
  const gltf = useModel(BODY_MODEL_URL)
  const invalidate = useThree((s) => s.invalidate)
  const ghost = useMemo(() => {
    const rig = buildRig(gltf.scene)
    const isForearm = (name: string) => /Right(ForeArm|Hand)/.test(name)
    const material = overlayMaterial(color, 0.4)
    for (const mesh of [rig.surface, rig.joints]) {
      mesh.geometry = geometryForBones(mesh, isForearm)
      mesh.material = material
      mesh.renderOrder = 2
    }
    return { rig, material }
  }, [gltf.scene, color])
  useEffect(
    () => () => {
      ghost.material.dispose()
      ghost.rig.surface.geometry.dispose()
      ghost.rig.joints.geometry.dispose()
    },
    [ghost],
  )
  const rangeRef = useRef(range)
  const driftRef = useRef(driftDeg)
  useEffect(() => {
    rangeRef.current = range
    driftRef.current = driftDeg
    invalidate()
  }, [range, driftDeg, invalidate])
  useFrame(({ clock }) => {
    const { min, max } = rangeRef.current
    const swing = 0.5 - 0.5 * Math.cos((clock.elapsedTime / 2) * Math.PI * 2) // 0..1..0 every 2 s
    poseRig(ghost.rig, min + (max - min) * swing, driftRef.current)
    invalidate() // keep the loop running only while the ghost is on screen
  })
  return <primitive object={ghost.rig.root} dispose={null} />
}

/** Colours each muscle area for its state: picked, pickable, part of the chosen group, or not measured. */
function paintMuscles(meshes: Map<string, THREE.Mesh>, markers: BodyMarker3D[], selected: string | null, hovered: string | null, palette: Palette) {
  const info = new Map(markers.filter((m) => m.kind === 'muscle').map((m) => [m.id, m]))
  for (const [id, mesh] of meshes) {
    const marker = info.get(id)
    const mat = mesh.material as THREE.MeshStandardMaterial
    mesh.visible = !!marker
    if (!marker) continue
    const isSelected = id === selected
    const isHovered = id === hovered
    mat.color.set(isSelected || marker.selectable ? palette.accent : palette.muted)
    mat.opacity = isSelected ? 0.95 : isHovered ? 0.75 : marker.selectable ? 0.6 : marker.emphasised ? 0.5 : 0.28
    mat.depthWrite = false
  }
}

/** Muscle areas from muscles.glb, each attached to the bone it moves with. */
function Muscles({
  rig,
  markers,
  selected,
  hovered,
  palette,
  repose,
}: {
  rig: Rig
  markers: BodyMarker3D[]
  selected: string | null
  hovered: string | null
  palette: Palette
  repose: () => void
}) {
  const gltf = useModel(MUSCLES_MODEL_URL)
  const invalidate = useThree((s) => s.invalidate)
  // Built once from the file; nothing is added to the scene here.
  const meshes = useMemo(() => {
    const byId = new Map<string, THREE.Mesh>()
    gltf.scene.updateMatrixWorld(true)
    gltf.scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return
      const mesh = new THREE.Mesh(o.geometry, overlayMaterial('#888888', 0.5))
      mesh.name = o.name
      mesh.userData = { markerId: o.name, bone: String(o.userData.bone ?? ''), rest: o.matrixWorld.clone() }
      mesh.renderOrder = 1
      byId.set(o.name, mesh)
    })
    return byId
  }, [gltf.scene])

  useEffect(() => () => meshes.forEach((m) => (m.material as THREE.Material).dispose()), [meshes])

  // Muscles are modelled on the rest pose, so each is attached to its bone there, then the pose is put back.
  useEffect(() => {
    resetRig(rig)
    for (const mesh of meshes.values()) {
      const bone = findBone(rig.root, mesh.userData.bone)
      if (!bone) continue
      ;(mesh.userData.rest as THREE.Matrix4).decompose(mesh.position, mesh.quaternion, mesh.scale)
      rig.root.add(mesh)
      bone.attach(mesh)
    }
    repose()
    return () => meshes.forEach((m) => m.removeFromParent())
  }, [meshes, rig, repose])

  useEffect(() => {
    paintMuscles(meshes, markers, selected, hovered, palette)
    invalidate()
  }, [meshes, markers, selected, hovered, palette, invalidate])
  return null
}

function Scene({
  mode,
  markers,
  selected,
  hovered,
  onHover,
  onSelect,
  elbowAngleDeg,
  targetRange,
  upperArmDriftDeg,
  driftFault,
  showPods,
  showGhost,
  palette,
}: {
  mode: BodyModelMode
  markers: BodyMarker3D[]
  selected: string | null
  hovered: string | null
  onHover: (id: string | null) => void
  onSelect?: (id: string) => void
  elbowAngleDeg: number
  targetRange?: { min: number; max: number }
  upperArmDriftDeg: number
  driftFault: boolean
  showPods: boolean
  showGhost: boolean
  palette: Palette
}) {
  const invalidate = useThree((s) => s.invalidate)
  const [rig, setRig] = useState<Rig | null>(null)
  const [anchors, setAnchors] = useState<Record<string, THREE.Object3D>>({})
  const faultMesh = useRef<THREE.SkinnedMesh | null>(null)
  const pose = useRef({ elbow: elbowAngleDeg, drift: upperArmDriftDeg })
  const lastApplied = useRef(0)

  const applyPose = useCallback(() => {
    if (!rig) return
    poseRig(rig, pose.current.elbow, pose.current.drift)
    lastApplied.current = performance.now()
    invalidate()
  }, [rig, invalidate])

  // Once, on the rest pose: pod anchors on the skin, and the red upper-arm overlay for the drift fault.
  const handleRig = useCallback((r: Rig) => {
    const ready = r.root.userData.prepared as { anchors: Record<string, THREE.Object3D>; fault: THREE.SkinnedMesh } | undefined
    if (ready) {
      faultMesh.current = ready.fault
      setAnchors(ready.anchors)
      setRig(r)
      return
    }
    resetRig(r)
    const ray = new THREE.Raycaster()
    const made: Record<string, THREE.Object3D> = {}
    for (const [id, place] of Object.entries(POD_PLACES)) {
      const a = r.bones[place.from].getWorldPosition(new THREE.Vector3())
      const b = r.bones[place.to].getWorldPosition(new THREE.Vector3())
      const onAxis = a.clone().lerp(b, place.t)
      const dir = new THREE.Vector3(...place.dir).normalize()
      ray.set(onAxis.clone().addScaledVector(dir, 0.4), dir.clone().negate())
      const hit = ray.intersectObject(r.surface, false)[0]
      const point = hit ? hit.point : onAxis.clone().addScaledVector(dir, 0.045)
      const anchor = new THREE.Object3D()
      anchor.position.copy(point)
      // Local Y runs along the arm, local Z points out of the skin.
      const along = b.clone().sub(a).normalize()
      anchor.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(along.clone().cross(dir).normalize(), along, dir))
      r.root.add(anchor)
      r.bones[place.attach].attach(anchor)
      made[id] = anchor
    }
    const upperArm = new THREE.SkinnedMesh(
      geometryForBones(r.surface, (n) => /RightArm$/.test(n)),
      overlayMaterial('#ff0000', 0.85),
    )
    upperArm.bind(r.surface.skeleton, r.surface.bindMatrix)
    upperArm.frustumCulled = false
    upperArm.visible = false
    upperArm.renderOrder = 2
    r.surface.parent?.add(upperArm)
    // A frame fixed to the upper arm, sitting at the elbow with the world's axes at rest: the target arc is drawn in it.
    const elbowFrame = new THREE.Object3D()
    r.bones.rightForearm.getWorldPosition(elbowFrame.position)
    r.root.add(elbowFrame)
    r.bones.rightUpperArm.attach(elbowFrame)
    made.elbow = elbowFrame
    r.root.userData.prepared = { anchors: made, fault: upperArm }
    faultMesh.current = upperArm
    setAnchors(made)
    setRig(r)
  }, [])

  // Pose changes: straight away in the editor, at most 20 times a second in the live session.
  useEffect(() => {
    if (!rig) return
    // In the live session, ignore changes too small to see (under 1 degree): each redraw costs frame time.
    const shown = pose.current
    const tiny = mode === 'live' && lastApplied.current > 0 && Math.abs(shown.elbow - elbowAngleDeg) < 1 && Math.abs(shown.drift - upperArmDriftDeg) < 1
    if (tiny) return
    pose.current = { elbow: elbowAngleDeg, drift: upperArmDriftDeg }
    const minGap = mode === 'live' ? 50 : 0
    const wait = minGap - (performance.now() - lastApplied.current)
    if (wait <= 0) {
      applyPose()
      return
    }
    const timer = setTimeout(applyPose, wait)
    return () => clearTimeout(timer)
  }, [elbowAngleDeg, upperArmDriftDeg, rig, mode, applyPose])

  useEffect(() => {
    const mesh = faultMesh.current
    if (!mesh) return
    mesh.visible = driftFault
    ;(mesh.material as THREE.MeshStandardMaterial).color.set(palette.fault)
    invalidate()
  }, [driftFault, palette.fault, rig, invalidate])

  useEffect(() => {
    invalidate()
  }, [markers, selected, hovered, palette, targetRange?.min, targetRange?.max, showPods, showGhost, invalidate])

  const interactive = mode !== 'live'
  const byId = useMemo(() => new Map(markers.map((m) => [m.id, m])), [markers])
  /**
   * What is under the pointer. A ray through the body hits several things; the one
   * wanted is the nearest marker the person can actually see: a joint or pod anywhere
   * along the ray (joints sit inside the body), or a muscle on the near side of the skin.
   */
  const markerAt = (e: ThreeEvent<PointerEvent | MouseEvent>) => {
    e.stopPropagation()
    const skin = e.intersections.find((i) => i.object instanceof THREE.SkinnedMesh)?.distance ?? Infinity
    for (const hit of e.intersections) {
      const id = hit.object.userData.markerId as string | undefined
      const marker = id ? byId.get(id) : undefined
      if (!marker) continue
      if (marker.kind !== 'muscle' || hit.distance <= skin + 0.012) return marker.id
    }
    return null
  }

  return (
    <>
      <MannequinModel
        bodyColor={palette.body}
        jointColor={palette.joints}
        onRig={handleRig}
        onPointerMove={
          interactive
            ? (e) => {
                const id = markerAt(e as ThreeEvent<PointerEvent>)
                onHover(id && byId.has(id) ? id : null)
              }
            : undefined
        }
        onPointerOut={interactive ? () => onHover(null) : undefined}
        onClick={
          interactive
            ? (e) => {
                const id = markerAt(e as ThreeEvent<MouseEvent>)
                const marker = id ? byId.get(id) : undefined
                if (marker?.selectable) onSelect?.(marker.id)
              }
            : undefined
        }
      />

      {rig && markers.some((m) => m.kind === 'muscle') && (
        <Suspense fallback={null}>
          <Muscles rig={rig} markers={markers} selected={selected} hovered={hovered} palette={palette} repose={applyPose} />
        </Suspense>
      )}

      {rig &&
        markers
          .filter((m) => m.kind === 'joint' && JOINT_BONE[m.id])
          .map((m) => {
            const active = m.id === selected
            const hot = m.id === hovered
            const node = createPortal(
              <mesh userData={{ markerId: m.id }} renderOrder={4}>
                <sphereGeometry args={[!m.selectable ? (hot ? 0.02 : 0.016) : active || hot ? 0.034 : 0.028, 20, 20]} />
                <meshStandardMaterial
                  color={m.selectable ? palette.accent : palette.muted}
                  emissive={active ? palette.accent : '#000000'}
                  emissiveIntensity={active ? 0.5 : 0}
                  transparent
                  opacity={m.selectable ? 1 : 0.7}
                  depthTest={false}
                />
              </mesh>,
              rig.bones[JOINT_BONE[m.id]],
            )
            return <Fragment key={m.id}>{node}</Fragment>
          })}

      {rig &&
        showPods &&
        markers
          .filter((m) => m.kind === 'pod' && anchors[m.id])
          .map((m) => {
            const active = m.id === selected || m.id === hovered
            const color = m.status === 'strong' ? palette.good : m.status === 'weak' ? palette.warn : m.status === 'offline' ? palette.fault : palette.accent
            const node = createPortal(
              <group>
                <mesh userData={{ markerId: m.id }} position={[0, 0, 0.008]} scale={active ? 1.35 : 1} renderOrder={4}>
                  <capsuleGeometry args={[0.016, 0.03, 6, 14]} />
                  <meshStandardMaterial color={color} roughness={0.45} emissive={active ? color : '#000000'} emissiveIntensity={active ? 0.45 : 0} />
                </mesh>
                {active && (
                  <mesh position={[0, 0, 0.006]} renderOrder={3}>
                    <torusGeometry args={[0.04, 0.004, 8, 28]} />
                    <meshBasicMaterial color={palette.accent} />
                  </mesh>
                )}
              </group>,
              anchors[m.id],
            )
            return <Fragment key={m.id}>{node}</Fragment>
          })}

      {rig && targetRange && anchors.elbow && createPortal(<TargetArc range={targetRange} color={palette.accent} />, anchors.elbow)}
      {rig && targetRange && showGhost && (
        <Suspense fallback={null}>
          <GhostForearm range={targetRange} driftDeg={upperArmDriftDeg} color={palette.accent} />
        </Suspense>
      )}
    </>
  )
}

/**
 * Pointer events for the canvas. The app zooms the whole page to fit the screen
 * (CSS zoom), and the default pointer maths mixes zoomed and unzoomed pixels, so
 * a click would land beside the pointer. Measuring the pointer against the
 * canvas's on-screen box keeps both in the same units at any zoom.
 */
function zoomSafeEvents(store: Parameters<typeof pointerEvents>[0]) {
  return {
    ...pointerEvents(store),
    compute(event: { clientX: number; clientY: number }, state: RootState) {
      const box = state.gl.domElement.getBoundingClientRect()
      state.pointer.set(((event.clientX - box.left) / box.width) * 2 - 1, -((event.clientY - box.top) / box.height) * 2 + 1)
      state.raycaster.setFromCamera(state.pointer, state.camera)
    },
  }
}

/** Moves the camera to the preset for this view, smoothly, and exposes "reset". */
function CameraRig({ view, interactive, resetSignal }: { view: View; interactive: boolean; resetSignal: number }) {
  const controls = useRef<CameraControls | null>(null)
  const { camera, invalidate } = useThree()
  const first = useRef(true)
  useEffect(() => {
    const [px, py, pz] = view.position
    const [tx, ty, tz] = view.target
    if (interactive && controls.current) {
      void controls.current.setLookAt(px, py, pz, tx, ty, tz, !first.current)
    } else {
      camera.position.set(px, py, pz)
      camera.lookAt(tx, ty, tz)
    }
    first.current = false
    invalidate()
  }, [view, interactive, resetSignal, camera, invalidate])
  if (!interactive) return null
  return (
    <CameraControls
      ref={controls}
      makeDefault
      smoothTime={0.28}
      minDistance={0.7}
      maxDistance={6}
      minPolarAngle={0.5}
      maxPolarAngle={2.4}
      truckSpeed={0}
    />
  )
}

/**
 * The shared 3D body: a rigged mannequin whose right arm can bend, with
 * joints, muscle areas and sensor pods drawn on it. Display only: it shows
 * values the pages already have. It is hidden from screen readers; the list
 * or dropdown next to it is the accessible control.
 */
export function BodyModel3D({
  bodyRegion = 'full',
  markers = NO_MARKERS,
  selected = null,
  onSelect,
  elbowAngleDeg = 0,
  targetRange,
  upperArmDriftDeg = 0,
  driftFault = false,
  showPods = false,
  mode,
  height = 300,
  note,
}: {
  bodyRegion?: BodyRegion
  markers?: BodyMarker3D[]
  selected?: string | null
  onSelect?: (id: string) => void
  /** Right elbow angle: 0 = straight, 135 = fully curled. */
  elbowAngleDeg?: number
  targetRange?: { min: number; max: number }
  /** How far the right upper arm is swung forward, in degrees. */
  upperArmDriftDeg?: number
  driftFault?: boolean
  showPods?: boolean
  mode: BodyModelMode
  height?: number | string
  /** A line of plain text under the model, e.g. "This rig measures the right arm only." */
  note?: string
}) {
  const { theme } = useTheme()
  const [hovered, setHovered] = useState<string | null>(null)
  const [resetSignal, setResetSignal] = useState(0)
  const palette = useMemo<Palette>(() => {
    const dark = theme === 'dark'
    return {
      body: dark ? '#5a6478' : '#d9d3c9',
      joints: dark ? '#788299' : '#b8b0a3',
      accent: cssColor('--color-accent', dark ? '#6aa9f0' : '#1f5fa6'),
      good: cssColor('--color-emerald', '#248a3d'),
      warn: cssColor('--color-amber', '#c26900'),
      fault: cssColor('--color-crimson', '#d70015'),
      muted: dark ? '#8e97aa' : '#8b8478',
    }
  }, [theme])

  const interactive = mode !== 'live'
  const hoveredMarker = markers.find((m) => m.id === hovered)
  const selectedMarker = markers.find((m) => m.id === selected)
  const showGhost = mode === 'editor' && !!targetRange && selected === 'right-elbow'
  const view = mode === 'live' ? VIEWS.live : mode === 'setup' ? VIEWS.arm : showGhost ? VIEWS.elbow : VIEWS[bodyRegion]
  const pods = markers.filter((m) => m.kind === 'pod')

  return (
    <div className={clsx('flex w-full flex-col gap-2', height === '100%' && 'h-full')}>
      <div className="relative w-full overflow-hidden rounded-xl" style={{ height }}>
        <div aria-hidden className={clsx('h-full w-full', hoveredMarker?.selectable && 'cursor-pointer')}>
          <Canvas
            frameloop="demand"
            events={zoomSafeEvents}
            dpr={mode === 'live' ? 1 : [1, 2]}
            // Edge smoothing is on everywhere. On a laptop with no graphics chip it cost the Live page about 22% of its frame rate
            // (2% with it off): if Live stutters there, change this to `antialias: mode !== 'live'`.
            gl={{ alpha: true, antialias: true, powerPreference: mode === 'live' ? 'low-power' : 'default' }}
            camera={{ fov: 30, near: 0.05, far: 40, position: view.position }}
          >
            {/* Soft light from the top-left, a gentle fill, no cast shadows. */}
            <hemisphereLight args={['#ffffff', '#8a8378', 0.95]} />
            <directionalLight position={[-2.5, 3.5, 2.5]} intensity={1.15} />
            <directionalLight position={[2.5, 1.5, 1.5]} intensity={0.3} />
            <Suspense fallback={null}>
              <Scene
                mode={mode}
                markers={markers}
                selected={selected}
                hovered={hovered}
                onHover={setHovered}
                onSelect={onSelect}
                elbowAngleDeg={elbowAngleDeg}
                targetRange={targetRange}
                upperArmDriftDeg={upperArmDriftDeg}
                driftFault={driftFault}
                showPods={showPods}
                showGhost={showGhost}
                palette={palette}
              />
            </Suspense>
            <CameraRig view={view} interactive={interactive} resetSignal={resetSignal} />
          </Canvas>
        </div>

        {targetRange && (
          <p className="pointer-events-none absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-full bg-surface/90 px-2.5 py-1 text-[12px] font-semibold text-accent">
            <span className="h-2.5 w-2.5 rounded-sm bg-accent/40 ring-1 ring-accent" aria-hidden />
            Target {targetRange.min}–{targetRange.max}°
          </p>
        )}
        {driftFault && (
          <p className="pointer-events-none absolute bottom-2 left-2 inline-flex items-center gap-1.5 rounded-full bg-crimson px-2.5 py-1 text-[13px] font-bold text-accent-ink">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            Upper arm moving
          </p>
        )}
        {interactive && (
          <button
            type="button"
            onClick={() => setResetSignal((n) => n + 1)}
            className="absolute right-2 top-2 inline-flex items-center gap-1.5 rounded-full bg-surface/90 px-2.5 py-1 text-[12px] font-medium text-ink-muted hover:text-ink"
          >
            <RotateCcw className="h-3 w-3" aria-hidden />
            Reset view
          </button>
        )}
        {interactive && hoveredMarker && (
          <p className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-surface/95 px-3 py-1 text-[12px] font-medium text-ink shadow-[var(--shadow-ambient)]">
            {hoveredMarker.label}
            {hoveredMarker.kind === 'pod' && hoveredMarker.status ? ` · ${STATUS_WORD[hoveredMarker.status]}` : ''}
            {!hoveredMarker.selectable && hoveredMarker.kind !== 'pod' ? ` · ${NOT_MEASURED}` : ''}
          </p>
        )}
      </div>

      {showPods && pods.length > 0 && (
        <ul className="flex flex-wrap justify-center gap-1.5" aria-label="Pods on the model">
          {pods.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onSelect?.(p.id)}
                onMouseEnter={() => setHovered(p.id)}
                onMouseLeave={() => setHovered(null)}
                aria-pressed={selected === p.id}
                className={clsx(
                  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-medium',
                  selected === p.id ? 'bg-accent/10 text-accent ring-1 ring-accent/40' : 'bg-surface-secondary text-ink-muted',
                )}
              >
                <span
                  className={clsx('h-2.5 w-2.5 rounded-full', p.status === 'strong' ? 'bg-emerald' : p.status === 'weak' ? 'bg-amber' : 'bg-crimson')}
                  aria-hidden
                />
                {p.label} · {p.status ? STATUS_WORD[p.status] : ''}
              </button>
            </li>
          ))}
        </ul>
      )}

      {selectedMarker && !selectedMarker.selectable && selectedMarker.kind !== 'pod' && (
        <p className="text-center text-[12px] font-medium text-ink-muted">
          {selectedMarker.label}: {NOT_MEASURED}
        </p>
      )}
      {note && <p className="text-center text-[12px] font-medium text-ink-muted">{note}</p>}
    </div>
  )
}
