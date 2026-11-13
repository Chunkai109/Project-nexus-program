/*
Started from the output of: npx gltfjsx@6.5.3 body.glb --types --keepnames
then adapted: it loads through the app's own offline loader (modelLoader.ts)
instead of drei's useGLTF, drops the unused animation, replaces the model's
two materials with the mannequin colours, and hands back a posable rig.
*/
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { ThreeEvent } from '@react-three/fiber'
import { BODY_MODEL_URL, useModel } from './modelLoader'
import { buildRig, setRigMaterials, type Rig } from './rig'

/** The two parts the X Bot file is made of. */
export type MannequinNodes = {
  Beta_Surface: THREE.SkinnedMesh
  Beta_Joints: THREE.SkinnedMesh
  mixamorigHips: THREE.Bone
}

export function MannequinModel({
  bodyColor,
  jointColor,
  onRig,
  onPointerMove,
  onPointerOut,
  onClick,
}: {
  bodyColor: string
  jointColor: string
  /** Called once with the posable rig (still in its rest pose). */
  onRig: (rig: Rig) => void
  onPointerMove?: (e: ThreeEvent<PointerEvent>) => void
  onPointerOut?: () => void
  onClick?: (e: ThreeEvent<MouseEvent>) => void
}) {
  const gltf = useModel(BODY_MODEL_URL)
  const rig = useMemo(() => buildRig(gltf.scene), [gltf.scene])
  const materials = useMemo(
    () => ({
      body: new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0 }),
      joints: new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0 }),
    }),
    [],
  )

  useEffect(() => {
    setRigMaterials(rig, materials.body, materials.joints)
    onRig(rig)
  }, [rig, materials, onRig])

  useEffect(() => {
    materials.body.color.set(bodyColor)
    materials.joints.color.set(jointColor)
  }, [materials, bodyColor, jointColor])

  useEffect(
    () => () => {
      materials.body.dispose()
      materials.joints.dispose()
    },
    [materials],
  )

  return <primitive object={rig.root} dispose={null} onPointerMove={onPointerMove} onPointerOut={onPointerOut} onClick={onClick} />
}
