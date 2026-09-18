import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from '@/lib/AuthContext'
import { ThemeProvider } from '@/lib/ThemeContext'
import { BleProvider } from '@/lib/ble/BleProvider'
import { LoginPage } from '@/pages/LoginPage'
import { PatientExercises } from '@/pages/PatientExercises'
import { SensorSetup } from '@/pages/SensorSetup'
import { LiveSession } from '@/pages/LiveSession'
import { TherapistDashboard } from '@/pages/TherapistDashboard'
import type { UserRole } from '@/types'
import type { ReactNode } from 'react'

function RequireRole({ role, children }: { role: UserRole; children: ReactNode }) {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  if (user.role !== role) return <Navigate to={user.role === 'patient' ? '/patient/exercises' : '/physio'} replace />
  return <>{children}</>
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/patient/exercises"
        element={
          <RequireRole role="patient">
            <PatientExercises />
          </RequireRole>
        }
      />
      <Route
        path="/patient/setup/:exerciseId"
        element={
          <RequireRole role="patient">
            <SensorSetup />
          </RequireRole>
        }
      />
      <Route
        path="/patient/session/:exerciseId"
        element={
          <RequireRole role="patient">
            <LiveSession />
          </RequireRole>
        }
      />
      <Route
        path="/physio"
        element={
          <RequireRole role="physio">
            <TherapistDashboard />
          </RequireRole>
        }
      />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BleProvider>
          <AppRoutes />
        </BleProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}

export default App
