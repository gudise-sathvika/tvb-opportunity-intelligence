import { useEffect, useState } from 'react'
import { applyTheme, getPreferredTheme, setTheme } from '../../utils/theme'

/**
 * Light/dark control for the top navigation.
 *
 * The preference is applied on mount and persisted, so a reload keeps the
 * chosen theme. The label states the action, not the current state, which is
 * what a button label should do.
 */
export default function ThemeToggle() {
  const [theme, setThemeState] = useState<'light' | 'dark'>(() => getPreferredTheme())

  useEffect(() => {
    applyTheme(theme)
    // Applied once on mount; later changes go through `toggle`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggle = () => {
    const next = theme === 'light' ? 'dark' : 'light'
    setThemeState(next)
    setTheme(next)
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
      title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
    >
      {theme === 'light' ? 'Dark mode' : 'Light mode'}
    </button>
  )
}
