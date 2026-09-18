import { ArrowRight } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { PATIENT_ROSTER } from '@/lib/mockData'

export function PatientRosterGrid({ onOpenPatient }: { onOpenPatient: (id: string) => void }) {
  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
      {PATIENT_ROSTER.map((p) => (
        <Card key={p.id} className="p-6">
          <div className="mb-5 flex items-center gap-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-white"
              style={{ background: p.avatarColor }}
            >
              {p.name.charAt(0)}
            </div>
            <div className="min-w-0">
              <p className="truncate text-[14px] font-semibold text-ink">{p.name}</p>
              <p className="truncate text-[13px] text-ink-faint">{p.condition}</p>
            </div>
          </div>

          <div className="mb-5">
            <div className="mb-2 flex items-center justify-between text-[13px]">
              <span className="text-ink-muted">Adherence</span>
              <span className="font-medium text-ink">{p.adherence}%</span>
            </div>
            <ProgressBar value={p.adherence} tone={p.adherence > 85 ? 'emerald' : p.adherence > 70 ? 'accent' : 'amber'} />
          </div>

          <div className="flex items-center justify-between text-[13px]">
            <span className="text-ink-faint">Last session: {p.lastSession}</span>
            <button
              onClick={() => onOpenPatient(p.id)}
              className="flex items-center gap-1 font-medium text-accent transition-opacity duration-200 hover:opacity-80"
            >
              View Protocol
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        </Card>
      ))}
    </div>
  )
}
