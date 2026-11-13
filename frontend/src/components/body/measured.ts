/** What this rig actually measures. Everything else on the body model is shown grey with NOT_MEASURED. */
export const NOT_MEASURED = 'Not measured by this rig'

/** The only joint this rig measures: the right elbow, between Pod 2 (forearm) and Pod 3 (upper arm). */
export const MEASURED_JOINT_ID = 'right-elbow'

/** The only muscle this rig has a sensor on: the right bicep (Pod 1, EMG). */
export const MEASURED_MUSCLE_ID = 'right-biceps-brachii'

export const ARM_ONLY_NOTE = 'This rig measures the right arm only.'

export function muscleOptionLabel(id: string, label: string): string {
  return id === MEASURED_MUSCLE_ID ? `${label} (Pod 1)` : `${label}: ${NOT_MEASURED}`
}
