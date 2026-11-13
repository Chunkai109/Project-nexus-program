import * as THREE from 'three'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { BONES, type BoneKey } from './bones'

/** How far the arms hang down from the model's T-pose, so the figure stands naturally. */
const ARM_LOWER_DEG = 78
const WORLD_Y = new THREE.Vector3(0, 1, 0)
const WORLD_Z = new THREE.Vector3(0, 0, 1)
const WORLD_X = new THREE.Vector3(1, 0, 0)
const rad = THREE.MathUtils.degToRad

/** three.js strips reserved characters such as ":" from node names on load. */
export function sanitizeBoneName(name: string): string {
  return THREE.PropertyBinding.sanitizeNodeName(name)
}

export function findBone(root: THREE.Object3D, name: string): THREE.Bone | null {
  const found = root.getObjectByName(sanitizeBoneName(name))
  return found instanceof THREE.Bone ? found : null
}

interface Rest {
  local: THREE.Quaternion
  world: THREE.Quaternion
  parentWorld: THREE.Quaternion
}

export interface Rig {
  root: THREE.Object3D
  bones: Record<BoneKey, THREE.Bone>
  rest: Record<BoneKey, Rest>
  surface: THREE.SkinnedMesh
  joints: THREE.SkinnedMesh
  /** Elbow hinge axis in each forearm bone's own space (the world's vertical axis at rest). */
  elbowAxis: { right: THREE.Vector3; left: THREE.Vector3 }
}

/** A private, posable copy of the loaded model. Must be called while the scene is still in its rest pose. */
export function buildRig(scene: THREE.Object3D): Rig {
  const root = cloneSkinned(scene)
  root.updateMatrixWorld(true)
  const bones = {} as Record<BoneKey, THREE.Bone>
  const rest = {} as Record<BoneKey, Rest>
  for (const key of Object.keys(BONES) as BoneKey[]) {
    const bone = findBone(root, BONES[key])
    if (!bone) throw new Error(`Body model is missing bone ${BONES[key]}`)
    bones[key] = bone
    rest[key] = {
      local: bone.quaternion.clone(),
      world: bone.getWorldQuaternion(new THREE.Quaternion()),
      parentWorld: bone.parent!.getWorldQuaternion(new THREE.Quaternion()),
    }
  }
  const meshes: THREE.SkinnedMesh[] = []
  root.traverse((o) => {
    if (o instanceof THREE.SkinnedMesh) {
      o.frustumCulled = false // bounds are for the rest pose; the posed arm would be culled wrongly
      meshes.push(o)
    }
  })
  const surface = meshes.find((m) => m.name.includes('Surface')) ?? meshes[0]
  const joints = meshes.find((m) => m.name.includes('Joints')) ?? meshes[meshes.length - 1]
  const axisFor = (key: BoneKey) => WORLD_Y.clone().applyQuaternion(rest[key].world.clone().invert()).normalize()
  return { root, bones, rest, surface, joints, elbowAxis: { right: axisFor('rightForearm'), left: axisFor('leftForearm') } }
}

/** Turns a bone by `delta` in world space, measured from its rest pose. */
function setWorldDelta(rig: Rig, key: BoneKey, delta: THREE.Quaternion) {
  const r = rig.rest[key]
  // local = parentWorld^-1 * delta * parentWorld * restLocal
  rig.bones[key].quaternion.copy(r.parentWorld).invert().multiply(delta).multiply(r.parentWorld).multiply(r.local)
}

/** World-space turn that takes the right upper arm from the T-pose to hanging at the side, swung forward by `driftDeg`. */
export function upperArmDelta(driftDeg: number): THREE.Quaternion {
  const lower = new THREE.Quaternion().setFromAxisAngle(WORLD_Z, rad(ARM_LOWER_DEG))
  const swing = new THREE.Quaternion().setFromAxisAngle(WORLD_X, rad(-driftDeg))
  return swing.multiply(lower)
}

/**
 * Poses the figure: both arms hang at the sides; the right elbow is bent by
 * `elbowDeg` (0 = straight, 135 = fully curled) and the right upper arm is
 * swung forward by `driftDeg`.
 */
export function poseRig(rig: Rig, elbowDeg: number, driftDeg: number) {
  setWorldDelta(rig, 'rightUpperArm', upperArmDelta(driftDeg))
  setWorldDelta(rig, 'leftUpperArm', new THREE.Quaternion().setFromAxisAngle(WORLD_Z, rad(-ARM_LOWER_DEG)))
  const bend = new THREE.Quaternion().setFromAxisAngle(rig.elbowAxis.right, rad(elbowDeg))
  rig.bones.rightForearm.quaternion.copy(rig.rest.rightForearm.local).multiply(bend)
  rig.root.updateMatrixWorld(true)
}

/** Puts every posed bone back to the model's rest pose (the T-pose it was built in). */
export function resetRig(rig: Rig) {
  for (const key of Object.keys(rig.bones) as BoneKey[]) rig.bones[key].quaternion.copy(rig.rest[key].local)
  rig.root.updateMatrixWorld(true)
}

/** Poses any hinge for the model check page: knees and shoulders. Degrees from the standing pose. */
export function poseExtra(rig: Rig, kneeDeg: number, shoulderRaiseDeg: number) {
  const knee = new THREE.Quaternion().setFromAxisAngle(WORLD_X, rad(kneeDeg))
  setWorldDelta(rig, 'rightShin', knee)
  if (shoulderRaiseDeg !== 0) {
    const raise = new THREE.Quaternion().setFromAxisAngle(WORLD_Z, rad(ARM_LOWER_DEG - shoulderRaiseDeg))
    setWorldDelta(rig, 'rightUpperArm', raise)
  }
  rig.root.updateMatrixWorld(true)
}

/**
 * A copy of `mesh`'s geometry that keeps only the triangles that move mostly
 * with the given bones (used for the "ghost" forearm).
 */
export function geometryForBones(mesh: THREE.SkinnedMesh, keep: (boneName: string) => boolean): THREE.BufferGeometry {
  const geo = mesh.geometry.clone()
  const skinIndex = geo.getAttribute('skinIndex')
  const skinWeight = geo.getAttribute('skinWeight')
  const names = mesh.skeleton.bones.map((b) => b.name)
  const kept = (v: number) => {
    let w = 0
    for (let k = 0; k < 4; k++) if (keep(names[skinIndex.getComponent(v, k)] ?? '')) w += skinWeight.getComponent(v, k)
    return w
  }
  const index = geo.getIndex()
  const out: number[] = []
  const count = index ? index.count : skinIndex.count
  const full = maxWeight(skinWeight)
  for (let i = 0; i < count; i += 3) {
    const tri = [0, 1, 2].map((k) => (index ? index.getX(i + k) : i + k))
    const share = (kept(tri[0]) + kept(tri[1]) + kept(tri[2])) / (3 * full)
    if (share > 0.5) out.push(tri[0], tri[1], tri[2])
  }
  geo.setIndex(out)
  return geo
}

/** Skin weights may be stored as 0..1 floats or as normalised integers; this is the value that means "fully weighted". */
function maxWeight(attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): number {
  let m = 0
  for (let v = 0; v < Math.min(attr.count, 200); v++) {
    let s = 0
    for (let k = 0; k < 4; k++) s += attr.getComponent(v, k)
    m = Math.max(m, s)
  }
  return m || 1
}

/** Swaps the model's own materials for the app's two mannequin materials. */
export function setRigMaterials(rig: Rig, body: THREE.Material, joints: THREE.Material) {
  rig.surface.material = body
  rig.joints.material = joints
}
