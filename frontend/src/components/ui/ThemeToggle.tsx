import { Moon, Sun } from 'lucide-react'
import { useTheme } from '@/lib/ThemeContext'

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggleTheme } = useTheme()

  return (
    <button
      onClick={toggleTheme}
      aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
      title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
      className={`flex h-9 w-9 items-center justify-center rounded-full bg-surface-secondary text-ink-muted transition-all duration-200 ease-out hover:text-ink active:scale-[0.94] ${className ?? ''}`}
    >
      {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
    </button>
  )
}
