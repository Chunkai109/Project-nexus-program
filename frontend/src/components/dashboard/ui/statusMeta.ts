import { AlertTriangle, CameraOff, CheckCircle2, Clock } from 'lucide-react'
import type { RosterStatus } from '../physioModel'

/** Icon + word for every patient status. Order is the roster's default sort. */
export const STATUS_META: Record<RosterStatus, { label: string; icon: typeof CheckCircle2; text: string; order: number }> = {
  'needs-attention': { label: 'Needs attention', icon: AlertTriangle, text: 'text-crimson-ink', order: 0 },
  'check-camera': { label: 'Check camera', icon: CameraOff, text: 'text-amber-ink', order: 1 },
  inactive: { label: 'Inactive', icon: Clock, text: 'text-ink-muted', order: 2 },
  'on-track': { label: 'On track', icon: CheckCircle2, text: 'text-emerald-ink', order: 3 },
}

