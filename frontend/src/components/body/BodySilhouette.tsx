/** The outline stick figure shared by BodyMap and JointPicker, so both line up on the same 200×400 viewBox. */
export function BodySilhouette() {
  return (
    <g fill="none" stroke="var(--color-border-strong)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="100" cy="34" r="22" />
      <path d="M78 60 Q70 60 68 78 L64 148 Q63 158 72 160 L128 160 Q137 158 136 148 L132 78 Q130 60 122 60 Z" />
      <path d="M70 70 L40 90 L34 160" />
      <path d="M130 70 L160 90 L166 160" />
      <path d="M34 160 L28 178" />
      <path d="M166 160 L172 178" />
      <path d="M75 158 L70 245 L66 340 L64 368" />
      <path d="M125 158 L130 245 L134 340 L136 368" />
      <path d="M64 368 L52 378 L78 378" />
      <path d="M136 368 L148 378 L122 378" />
    </g>
  )
}
