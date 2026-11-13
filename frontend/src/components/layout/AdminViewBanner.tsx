import { Link } from 'react-router-dom'
import { ArrowLeft, ShieldCheck } from 'lucide-react'
import { PRACTICES } from '@/lib/mockData'

/** Shown above the physio dashboard when an admin has a clinic open, so it is always clear whose data this is and how to leave. */
export function AdminViewBanner({ practiceId }: { practiceId: string }) {
  const clinic = PRACTICES.find((p) => p.id === practiceId)?.name ?? practiceId
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 bg-amber/10 px-4 py-2 text-[15px] font-semibold text-amber-ink" role="status">
      <span className="inline-flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 flex-shrink-0" aria-hidden />
        Admin view: {clinic}. Changes you make here are real.
      </span>
      <Link to="/admin" className="inline-flex items-center gap-1.5 underline">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to Admin
      </Link>
    </div>
  )
}
