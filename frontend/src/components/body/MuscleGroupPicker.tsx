import { Suspense, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useLoader, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import * as THREE from 'three'
import { useTheme } from '@/lib/ThemeContext'

/** The scanned human mesh is ~20.7 units tall in its own coordinate space; this brings it down to the ~1.8-unit scene scale the camera/OrbitControls are tuned for. */
const MODEL_SCALE = 0.087

/**
 * Marker positions are authored in the model's own (pre-scale) coordinate
 * space, then converted once below — much easier to eyeball against the raw
 * mesh than working in the tiny post-scale numbers. Each is pushed outward
 * past the body's actual surface at that point (verified empirically) so the
 * opaque mesh in front of it never blocks the raycast; bilateral regions get
 * two markers that both select the same group.
 */
const RAW_MARKERS: { id: string; groupId: string; position: [number, number, number] }[] = [
  { id: 'chest', groupId: 'chest', position: [0, 15.3, 2.2] },
  { id: 'back', groupId: 'back', position: [0, 15.3, -2.5] },
  { id: 'core', groupId: 'core', position: [0, 11.3, 2.0] },
  { id: 'left-shoulder', groupId: 'shoulder', position: [-2.0, 17.0, 0.6] },
  { id: 'right-shoulder', groupId: 'shoulder', position: [2.0, 17.0, 0.6] },
  { id: 'left-arm', groupId: 'arm', position: [-3.4, 13.6, 0.3] },
  { id: 'right-arm', groupId: 'arm', position: [3.4, 13.6, 0.3] },
  { id: 'left-forearm', groupId: 'forearm', position: [-5.2, 10.6, 0.2] },
  { id: 'right-forearm', groupId: 'forearm', position: [5.2, 10.6, 0.2] },
  { id: 'left-upper-leg', groupId: 'upper-leg', position: [-1.6, 8.0, 1.6] },
  { id: 'right-upper-leg', groupId: 'upper-leg', position: [1.6, 8.0, 1.6] },
  { id: 'left-lower-leg', groupId: 'lower-leg', position: [-1.3, 3.3, 1.3] },
  { id: 'right-lower-leg', groupId: 'lower-leg', position: [1.3, 3.3, 1.3] },
]

interface GroupMarker {
  id: string
  groupId: string
  position: [number, number, number]
}

const MARKERS: GroupMarker[] = RAW_MARKERS.map((m) => ({
  ...m,
  position: m.position.map((v) => v * MODEL_SCALE) as [number, number, number],
}))

function Marker({
  marker,
  isSelected,
  onSelect,
  accentColor,
  baseColor,
}: {
  marker: GroupMarker
  isSelected: boolean
  onSelect: (groupId: string) => void
  accentColor: string
  baseColor: string
}) {
  const [hovered, setHovered] = useState(false)
  const downPos = useRef<{ x: number; y: number } | null>(null)

  return (
    <mesh
      position={marker.position}
      onPointerDown={(e) => {
        downPos.current = { x: e.clientX, y: e.clientY }
      }}
      onClick={(e) => {
        e.stopPropagation()
        const down = downPos.current
        if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return
        onSelect(marker.groupId)
      }}
      onPointerOver={(e) => {
        e.stopPropagation()
        setHovered(true)
        document.body.style.cursor = 'pointer'
      }}
      onPointerOut={() => {
        setHovered(false)
        document.body.style.cursor = 'auto'
      }}
    >
      <sphereGeometry args={[isSelected || hovered ? 0.052 : 0.042, 20, 20]} />
      <meshStandardMaterial
        color={isSelected ? accentColor : baseColor}
        emissive={isSelected ? accentColor : '#000000'}
        emissiveIntensity={isSelected ? 0.4 : 0}
        roughness={0.4}
      />
    </mesh>
  )
}

/** Loads the scanned human mesh and applies our own theme-aware material — the source file has no accompanying .mtl, so any embedded material references are ignored. */
function HumanMesh({ skinColor }: { skinColor: string }) {
  const obj = useLoader(OBJLoader, '/models/human-figure.obj')

  const model = useMemo(() => {
    const clone = obj.clone()
    clone.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.material = new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.75 })
      }
    })
    return clone
  }, [obj, skinColor])

  return <primitive object={model} scale={MODEL_SCALE} />
}

function Figure({
  selectedGroupId,
  onSelect,
  accentColor,
  baseColor,
  skinColor,
}: {
  selectedGroupId: string | null
  onSelect: (groupId: string) => void
  accentColor: string
  baseColor: string
  skinColor: string
}) {
  return (
    <group>
      <Suspense fallback={null}>
        <HumanMesh skinColor={skinColor} />
      </Suspense>

      {MARKERS.map((marker) => (
        <Marker
          key={marker.id}
          marker={marker}
          isSelected={selectedGroupId === marker.groupId}
          onSelect={onSelect}
          accentColor={accentColor}
          baseColor={baseColor}
        />
      ))}
    </group>
  )
}

/** Sets the initial camera distance — done here rather than via Canvas's `camera` prop so it composes cleanly with OrbitControls' own target. */
function Rig() {
  const { camera } = useThree()
  useLayoutEffect(() => {
    camera.position.set(0, 1.2, 2.0)
  }, [camera])
  return null
}

/**
 * One tap on a marker reveals which muscle group it is (bilateral regions
 * like Shoulder or Arm have two markers that both select the same group);
 * the specific muscle within that group is then picked from a dropdown, not
 * from the figure itself. Chest and Back sit on opposite sides of the torso,
 * so rotating the figure is what reveals Back — the reason this is a 3D
 * rotatable figure rather than a flat stickman.
 */
export function MuscleGroupPicker({
  selectedGroupId,
  onSelect,
  height = 260,
}: {
  selectedGroupId: string | null
  onSelect: (groupId: string) => void
  height?: number
}) {
  const { theme } = useTheme()
  const isDark = theme === 'dark'
  const accentColor = isDark ? '#0a84ff' : '#0071e3'
  const baseColor = '#86868b'
  const skinColor = isDark ? '#6e6e73' : '#d1d1d6'

  return (
    <div style={{ height, width: '100%' }}>
      <Canvas gl={{ alpha: true, antialias: true }} dpr={[1, 2]}>
        <Rig />
        <ambientLight intensity={0.7} />
        <directionalLight position={[2, 3, 2]} intensity={0.9} />
        <directionalLight position={[-2, 1, -2]} intensity={0.3} />
        <Figure
          selectedGroupId={selectedGroupId}
          onSelect={onSelect}
          accentColor={accentColor}
          baseColor={baseColor}
          skinColor={skinColor}
        />
        <OrbitControls
          target={[0, 1.1, 0]}
          enableZoom={false}
          enablePan={false}
          minPolarAngle={0.6}
          maxPolarAngle={2.6}
          rotateSpeed={0.7}
        />
      </Canvas>
    </div>
  )
}
