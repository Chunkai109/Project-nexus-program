/**
 * The one place the mannequin's bone names are written down (Mixamo X Bot).
 * Note: three.js removes the colon when it loads the file
 * ("mixamorig:RightArm" becomes "mixamorigRightArm"), so always look a bone
 * up through `findBone` in rig.ts, never by comparing names directly.
 */
export const BONES = {
  rightShoulder: 'mixamorig:RightShoulder',
  rightUpperArm: 'mixamorig:RightArm',
  rightForearm: 'mixamorig:RightForeArm',
  rightHand: 'mixamorig:RightHand',
  spine: 'mixamorig:Spine',
  rightThigh: 'mixamorig:RightUpLeg',
  rightShin: 'mixamorig:RightLeg',
  // The matching left-side bones, used for the resting pose and for joint markers.
  leftUpperArm: 'mixamorig:LeftArm',
  leftForearm: 'mixamorig:LeftForeArm',
  leftThigh: 'mixamorig:LeftUpLeg',
  leftShin: 'mixamorig:LeftLeg',
} as const

export type BoneKey = keyof typeof BONES
