import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PatientHeader } from '@/components/patient/PatientHeader'
import { useAuth } from '@/lib/AuthContext'
import { useAppData } from '@/lib/data/AppDataContext'
import { useSensorHub } from '@/lib/hub/HubProvider'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/** The patient top bar wired to real state: the hub's actual connection and the patient's own sessions. */
export function PatientTopNav() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const { sessions, patients } = useAppData()
  const hub = useSensorHub()
  const myPatientId = patients.find((p) => p.email === user?.email)?.id
  // "This week" is measured from when this screen opened.
  const [cutoff] = useState(() => Date.now() - WEEK_MS)
  const sessionsThisWeek = sessions.filter((s) => s.patientId === myPatientId && s.completedAt >= cutoff).length

  return (
    <PatientHeader
      userName={user?.name ?? 'Patient'}
      hubState={hub.connectionState}
      sessionsThisWeek={sessionsThisWeek}
      onSignOut={() => {
        signOut()
        navigate('/login')
      }}
    />
  )
}
