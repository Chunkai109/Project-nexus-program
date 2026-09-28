import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

export interface InspectorEntry {
  title: string
  description: string
}

interface InspectorContextValue {
  active: InspectorEntry | null
  setActive: (entry: InspectorEntry | null) => void
}

const InspectorContext = createContext<InspectorContextValue | null>(null)

/**
 * Backs the bottom-right Inspector HUD (see InspectorHUD.tsx) — whichever
 * card or chart the pointer is currently over publishes its definition here,
 * and the HUD just renders whatever's active. One provider per PageShell
 * instance is fine: nothing here needs to survive a route change.
 */
export function InspectorProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<InspectorEntry | null>(null)
  const value = useMemo(() => ({ active, setActive }), [active])
  return <InspectorContext.Provider value={value}>{children}</InspectorContext.Provider>
}

export function useInspector(): InspectorContextValue {
  const ctx = useContext(InspectorContext)
  if (!ctx) throw new Error('useInspector must be used within InspectorProvider')
  return ctx
}
