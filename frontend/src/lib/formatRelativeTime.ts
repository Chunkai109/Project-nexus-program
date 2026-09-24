export function formatRelativeTime(timestampMs: number): string {
  const diffSec = Math.max(0, (Date.now() - timestampMs) / 1000)
  if (diffSec < 60) return 'just now'
  const diffMin = diffSec / 60
  if (diffMin < 60) return `${Math.floor(diffMin)}m ago`
  const diffHr = diffMin / 60
  if (diffHr < 24) return `${Math.floor(diffHr)}h ago`
  const diffDay = diffHr / 24
  if (diffDay < 30) return `${Math.floor(diffDay)}d ago`
  return new Date(timestampMs).toLocaleDateString()
}

/** Deterministic pastel-ish color from a string, so real patients get distinct avatar colors without storing one. */
export function hashColor(input: string): string {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i)
    hash |= 0
  }
  const hue = Math.abs(hash) % 360
  return `hsl(${hue}, 65%, 55%)`
}
