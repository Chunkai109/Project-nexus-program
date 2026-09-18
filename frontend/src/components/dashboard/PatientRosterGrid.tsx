import { ArrowRight } from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { PATIENT_ROSTER } from '@/lib/mockData'

export function PatientRosterGrid({ onOpenPatient }: { onOpenPatient: (id: string) => void }) {
  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
      {PATIENT_ROSTER.map((p) => (
        <GlassCard key={p.id} className="p-5">
          <div className="mb-4 flex items-center gap-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-slate-950"
              style={{ background: p.avatarColor }}
            >
              {p.name.charAt(0)}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">{p.name}</p>
              <p className="truncate text-xs text-ink-faint">{p.condition}</p>
            </div>
          </div>

          <div className="mb-4">
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="text-ink-muted">Adherence</span>
              <span className="font-medium text-ink">{p.adherence}%</span>
            </div>
            <ProgressBar value={p.adherence} tone={p.adherence > 85 ? 'emerald' : p.adherence > 70 ? 'electric' : 'amber'} />
          </div>

          <div className="flex items-center justify-between text-xs">
            <span className="text-ink-faint">Last session: {p.lastSession}</span>
            <button
              onClick={() => onOpenPatient(p.id)}
              className="flex items-center gap-1 font-medium text-electric transition-colors hover:text-electric-dim"
            >
              View Protocol
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        </GlassCard>
      ))}
    </div>
  )
}
