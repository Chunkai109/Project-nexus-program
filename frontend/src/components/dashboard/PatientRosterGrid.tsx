import { useMemo } from 'react'
import { useAppData } from '@/lib/data/AppDataContext'
import { buildRosterRows } from './physioModel'
import { RosterView } from './RosterView'

/**
 * The real Patients list: rows built from this practice's recorded sessions
 * only. A patient with no sessions shows Inactive, "No sessions yet".
 * (The data layer does not report load errors yet, so only loading is shown.)
 */
export function PatientRosterGrid({ onSelectPatient }: { onSelectPatient: (patientId: string) => void }) {
  const { patients, sessions, loading } = useAppData()
  const rows = useMemo(() => buildRosterRows(patients, sessions), [patients, sessions])
  return <RosterView rows={rows} loading={loading} onOpen={onSelectPatient} />
}
