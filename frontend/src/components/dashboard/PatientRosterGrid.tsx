import { ChevronRight, UserRound } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { useAppData } from '@/lib/data/AppDataContext'
import { formatRelativeTime, hashColor } from '@/lib/formatRelativeTime'

export function PatientRosterGrid({ onSelectPatient }: { onSelectPatient?: (patientId: string) => void }) {
  const { patients } = useAppData()

  if (patients.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-3 p-16 text-center">
        <UserRound className="h-8 w-8 text-ink-faint" />
        <p className="text-[15px] font-medium text-ink">No patients yet</p>
        <p className="max-w-sm text-[13px] text-ink-faint">
          This list populates automatically the first time a patient signs in — there's nothing to seed manually.
        </p>
      </Card>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
      {patients.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onSelectPatient?.(p.id)}
          className="w-full text-left"
        >
          <Card className="flex flex-col p-6 transition-transform duration-200 hover:-translate-y-0.5">
            <div className="mb-4 flex items-center gap-3">
              <div
                className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
                style={{ background: hashColor(p.email) }}
              >
                {p.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-semibold text-ink">{p.name}</p>
                <p className="truncate text-[13px] text-ink-faint">{p.email}</p>
              </div>
              <ChevronRight className="h-4 w-4 flex-shrink-0 text-ink-faint" />
            </div>

            <div className="flex items-center justify-between text-[13px]">
              <span className="text-ink-faint">Last active: {formatRelativeTime(p.lastSeenAt)}</span>
              <span className="text-ink-faint">Since {formatRelativeTime(p.firstSeenAt)}</span>
            </div>
          </Card>
        </button>
      ))}
    </div>
  )
}
