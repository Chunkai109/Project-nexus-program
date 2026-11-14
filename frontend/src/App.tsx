import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from '@/lib/AuthContext'
import { ThemeProvider } from '@/lib/ThemeContext'
import { AppDataProvider } from '@/lib/data/AppDataContext'
import { HubProvider } from '@/lib/hub/HubProvider'
import { LoginPage } from '@/pages/LoginPage'
import { PatientExercises } from '@/pages/PatientExercises'
import { PastSessions } from '@/pages/PastSessions'
import { SensorSetup } from '@/pages/SensorSetup'
import { CalibrationPage } from '@/pages/CalibrationPage'
import { LiveSession } from '@/pages/LiveSession'
import { SessionSummary } from '@/pages/SessionSummary'
import { TherapistDashboard } from '@/pages/TherapistDashboard'
import { PatientDemo } from '@/demo/PatientDemo'
import { PhysioDemo } from '@/demo/PhysioDemo'
import { BodyCheck } from '@/demo/BodyCheck'
import { AdminPage } from '@/pages/AdminPage'
import { homeFor } from '@/lib/homeFor'
import { useAppZoom } from '@/components/layout/useAppZoom'
import { DevPreviewProvider, WithDevPreview } from '@/components/layout/DevPreview'
import type { UserRole } from '@/types'
import type { ReactNode } from 'react'

/** `adminToo` lets an admin in as well: the admin works in the clinic they have open, like one of its physiotherapists. */
function RequireRole({ role, adminToo = false, children }: { role: UserRole; adminToo?: boolean; children: ReactNode }) {
  const { user, initializing } = useAuth()
  if (initializing) return null
  if (!user) return <Navigate to="/login" replace />
  if (user.role !== role && !(adminToo && user.role === 'admin')) return <Navigate to={homeFor(user.role)} replace />
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
        path="/patient/history"
        element={
          <RequireRole role="patient">
            <PastSessions />
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
        path="/patient/calibrate/:exerciseId"
        element={
          <RequireRole role="patient">
            <CalibrationPage />
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
        path="/patient/session-summary/:sessionId"
        element={
          <RequireRole role="patient">
            <SessionSummary />
          </RequireRole>
        }
      />
      <Route
        path="/physio"
        element={
          <RequireRole role="physio" adminToo>
            <TherapistDashboard />
          </RequireRole>
        }
      />
      <Route
        path="/admin"
        element={
          <RequireRole role="admin">
            <AdminPage />
          </RequireRole>
        }
      />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}

function App() {
  // Scales the whole app to the window; covers the demo route too.
  useAppZoom()
  return (
    <ThemeProvider>
      <Routes>
        {/* The demo preview sits OUTSIDE the auth, data and hub providers on purpose:
            it has no way to read or write patient records or reach the hub. */}
        <Route path="/demo/patient/:screen?" element={<PatientDemo />} />
        <Route path="/demo/physio/:screen?" element={<PhysioDemo />} />
        {/* Developer check page for the 3D body model. Reads and writes nothing. */}
        <Route path="/demo/body" element={<BodyCheck />} />
        <Route
          path="*"
          element={
            <DevPreviewProvider>
              <AuthProvider>
                {/* On a development build an admin can swap in the preview's own sign-in and sandbox data (DevPreview.tsx). */}
                <WithDevPreview real={(routes) => <AppDataProvider>{routes}</AppDataProvider>}>
                  <HubProvider>
                    <AppRoutes />
                  </HubProvider>
                </WithDevPreview>
              </AuthProvider>
            </DevPreviewProvider>
          }
        />
      </Routes>
    </ThemeProvider>
  )
}

export default App
