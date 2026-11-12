import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageShell } from '@/components/layout/PageShell'
import { PatientTopNav } from '@/components/layout/PatientTopNav'
import { PatientNavTabs } from '@/components/layout/PatientNavTabs'
import { ExerciseSelectionView, type ExerciseToday } from '@/components/patient/ExerciseSelectionView'
import { useAppData } from '@/lib/data/AppDataContext'
import { useAuth } from '@/lib/AuthContext'

function startOfToday(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function PatientExercises() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { exercises, patients, sessions } = useAppData()
  const myPatientId = patients.find((p) => p.email === user?.email)?.id

  const items = useMemo<ExerciseToday[]>(() => {
    if (!myPatientId) return []
    const today = startOfToday()
    // Only plans made for this patient. Presets are physio-only.
    return exercises
      .filter((ex) => ex.assignedPatientId === myPatientId)
      .map((exercise) => ({
        exercise,
        doneToday:
          sessions
            .filter((s) => s.patientId === myPatientId && s.exerciseId === exercise.id && s.completedAt >= today)
            .sort((a, b) => b.completedAt - a.completedAt)[0] ?? null,
      }))
  }, [exercises, sessions, myPatientId])

  return (
    <PageShell>
      <ExerciseSelectionView
        header={<PatientTopNav />}
        tabs={<PatientNavTabs />}
        items={items}
        onStart={(id) => navigate(`/patient/setup/${id}`)}
      />
    </PageShell>
  )
}
