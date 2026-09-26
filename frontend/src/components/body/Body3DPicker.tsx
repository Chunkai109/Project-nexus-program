import { Suspense, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useLoader, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import * as THREE from 'three'
import { useTheme } from '@/lib/ThemeContext'

/** The scanned human mesh is ~20.7 units tall in its own coordinate space; this brings it down to the ~1.8-unit scene scale the camera/OrbitControls are tuned for. */
export const MODEL_SCALE = 0.087

const EMPTY_SET: Set<string> = new Set()

export interface BodyMarker {
  id: string
  value: string
  position: [number, number, number]
}

/**
 * Converts marker positions authored in the model's own (pre-scale)
 * coordinate space — much easier to measure straight off the raw mesh's
 * vertices than working in the tiny post-scale numbers — into scene units.
 */
export function scaleMarkers(raw: BodyMarker[]): BodyMarker[] {
  return raw.map((m) => ({ ...m, position: m.position.map((v) => v * MODEL_SCALE) as [number, number, number] }))
}

function Marker({
  marker,
  isSelected,
  isConfirmed,
  onSelect,
  accentColor,
  baseColor,
  confirmedColor,
}: {
  marker: BodyMarker
  isSelected: boolean
  isConfirmed: boolean
  onSelect: (value: string) => void
  accentColor: string
  baseColor: string
  confirmedColor: string
}) {
  const [hovered, setHovered] = useState(false)
  const downPos = useRef<{ x: number; y: number } | null>(null)

  const color = isSelected ? accentColor : isConfirmed ? confirmedColor : baseColor

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
        onSelect(marker.value)
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
        color={color}
        emissive={isSelected || isConfirmed ? color : '#000000'}
        emissiveIntensity={isSelected || isConfirmed ? 0.4 : 0}
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
  markers,
  selectedValue,
  confirmedValues,
  onSelect,
  accentColor,
  baseColor,
  confirmedColor,
  skinColor,
}: {
  markers: BodyMarker[]
  selectedValue: string | null
  confirmedValues: Set<string>
  onSelect: (value: string) => void
  accentColor: string
  baseColor: string
  confirmedColor: string
  skinColor: string
}) {
  return (
    <group>
      <Suspense fallback={null}>
        <HumanMesh skinColor={skinColor} />
      </Suspense>

      {markers.map((marker) => (
        <Marker
          key={marker.id}
          marker={marker}
          isSelected={selectedValue === marker.value}
          isConfirmed={confirmedValues.has(marker.value)}
          onSelect={onSelect}
          accentColor={accentColor}
          baseColor={baseColor}
          confirmedColor={confirmedColor}
        />
      ))}
    </group>
  )
}

/** Sets the initial camera distance — done here rather than via Canvas's `camera` prop so it composes cleanly with OrbitControls' own target. */
function Rig() {
  const { camera } = useThree()
  useLayoutEffect(() => {
    camera.position.set(0, 1.0, 1.5)
  }, [camera])
  return null
}

/**
 * A rotatable 3D scan of a human figure with clickable markers on it —
 * shared by the EMG step's muscle-group picker and the angle-configuration
 * step's joint picker so both present the exact same model, camera framing,
 * and tap/rotate interaction, differing only in which markers they place and
 * what each one selects.
 */
export function Body3DPicker({
  markers,
  selectedValue,
  confirmedValues,
  onSelect,
  height = 260,
  unconfirmedColor,
}: {
  markers: BodyMarker[]
  selectedValue: string | null
  /** Markers whose value is in this set render in the confirmed (green) color instead of the default. */
  confirmedValues?: Set<string>
  onSelect: (value: string) => void
  height?: number
  /** Color for markers that are neither selected nor confirmed. Defaults to a neutral gray. */
  unconfirmedColor?: string
}) {
  const { theme } = useTheme()
  const isDark = theme === 'dark'
  const accentColor = isDark ? '#0a84ff' : '#0071e3'
  const baseColor = unconfirmedColor ?? '#86868b'
  const confirmedColor = isDark ? '#32d74b' : '#248a3d'
  const skinColor = isDark ? '#6e6e73' : '#d1d1d6'

  return (
    <div style={{ height, width: '100%' }}>
      <Canvas gl={{ alpha: true, antialias: true }} dpr={[1, 2]}>
        <Rig />
        <ambientLight intensity={0.7} />
        <directionalLight position={[2, 3, 2]} intensity={0.9} />
        <directionalLight position={[-2, 1, -2]} intensity={0.3} />
        <Figure
          markers={markers}
          selectedValue={selectedValue}
          confirmedValues={confirmedValues ?? EMPTY_SET}
          onSelect={onSelect}
          accentColor={accentColor}
          baseColor={baseColor}
          confirmedColor={confirmedColor}
          skinColor={skinColor}
        />
        <OrbitControls
          target={[0, 0.95, 0]}
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
