import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { useTheme } from '@/lib/ThemeContext'

/** Bilateral regions get two markers (both select the same group); Chest/Back/Core get one each, split front vs. rear so rotating the figure is what reveals Back. */
interface GroupMarker {
  id: string
  groupId: string
  position: [number, number, number]
}

const MARKERS: GroupMarker[] = [
  { id: 'chest', groupId: 'chest', position: [0, 1.28, 0.2] },
  { id: 'back', groupId: 'back', position: [0, 1.28, -0.2] },
  { id: 'core', groupId: 'core', position: [0, 1.02, 0.2] },
  { id: 'left-shoulder', groupId: 'shoulder', position: [-0.22, 1.48, 0] },
  { id: 'right-shoulder', groupId: 'shoulder', position: [0.22, 1.48, 0] },
  { id: 'left-arm', groupId: 'arm', position: [-0.26, 1.32, 0] },
  { id: 'right-arm', groupId: 'arm', position: [0.26, 1.32, 0] },
  { id: 'left-forearm', groupId: 'forearm', position: [-0.31, 1.0, 0] },
  { id: 'right-forearm', groupId: 'forearm', position: [0.31, 1.0, 0] },
  { id: 'left-upper-leg', groupId: 'upper-leg', position: [-0.12, 0.75, 0] },
  { id: 'right-upper-leg', groupId: 'upper-leg', position: [0.12, 0.75, 0] },
  { id: 'left-lower-leg', groupId: 'lower-leg', position: [-0.12, 0.35, 0] },
  { id: 'right-lower-leg', groupId: 'lower-leg', position: [0.12, 0.35, 0] },
]

/** Skeleton "bones" — thin cylinders between two joints, purely visual context for the markers. */
const BONES: [[number, number, number], [number, number, number]][] = [
  [[0, 1.5, 0], [0, 0.95, 0]], // spine
  [[0, 1.62, 0], [0, 1.5, 0]], // neck
  [[0, 1.5, 0], [-0.22, 1.48, 0]], // left clavicle
  [[0, 1.5, 0], [0.22, 1.48, 0]], // right clavicle
  [[-0.22, 1.48, 0], [-0.3, 1.15, 0]], // left upper arm
  [[0.22, 1.48, 0], [0.3, 1.15, 0]], // right upper arm
  [[-0.3, 1.15, 0], [-0.32, 0.85, 0]], // left forearm
  [[0.3, 1.15, 0], [0.32, 0.85, 0]], // right forearm
  [[0, 0.95, 0], [-0.12, 0.95, 0]], // left hip link
  [[0, 0.95, 0], [0.12, 0.95, 0]], // right hip link
  [[-0.12, 0.95, 0], [-0.12, 0.55, 0]], // left thigh
  [[0.12, 0.95, 0], [0.12, 0.55, 0]], // right thigh
  [[-0.12, 0.55, 0], [-0.12, 0.15, 0]], // left shin
  [[0.12, 0.55, 0], [0.12, 0.15, 0]], // right shin
]

const JOINTS: [number, number, number][] = [
  [-0.22, 1.48, 0],
  [0.22, 1.48, 0],
  [-0.3, 1.15, 0],
  [0.3, 1.15, 0],
  [-0.32, 0.85, 0],
  [0.32, 0.85, 0],
  [-0.12, 0.95, 0],
  [0.12, 0.95, 0],
  [-0.12, 0.55, 0],
  [0.12, 0.55, 0],
  [-0.12, 0.15, 0],
  [0.12, 0.15, 0],
]

function Bone({ from, to, color }: { from: [number, number, number]; to: [number, number, number]; color: string }) {
  const { position, quaternion, length } = useMemo(() => {
    const start = new THREE.Vector3(...from)
    const end = new THREE.Vector3(...to)
    const dir = end.clone().sub(start)
    const len = dir.length()
    const mid = start.clone().add(end).multiplyScalar(0.5)
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize())
    return { position: mid, quaternion: quat, length: len }
  }, [from, to])

  return (
    <mesh position={position} quaternion={quaternion}>
      <cylinderGeometry args={[0.018, 0.018, length, 8]} />
      <meshStandardMaterial color={color} roughness={0.6} />
    </mesh>
  )
}

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
      {/* Head */}
      <mesh position={[0, 1.72, 0]}>
        <sphereGeometry args={[0.12, 24, 24]} />
        <meshStandardMaterial color={skinColor} roughness={0.7} />
      </mesh>

      {BONES.map(([from, to], i) => (
        <Bone key={i} from={from} to={to} color={skinColor} />
      ))}
      {JOINTS.map((pos, i) => (
        <mesh key={i} position={pos}>
          <sphereGeometry args={[0.03, 12, 12]} />
          <meshStandardMaterial color={skinColor} roughness={0.7} />
        </mesh>
      ))}

      {/* Torso shell (visual only, not clickable) */}
      <mesh position={[0, 1.22, 0]}>
        <capsuleGeometry args={[0.15, 0.32, 4, 12]} />
        <meshStandardMaterial color={skinColor} roughness={0.7} />
      </mesh>

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
    camera.position.set(0, 1.15, 1.55)
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
