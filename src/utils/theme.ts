export const THEME_KEY = 'tvb-theme'

export function getPreferredTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light'
  const stored = localStorage.getItem(THEME_KEY) as 'light' | 'dark' | null
  if (stored === 'light' || stored === 'dark') return stored
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark'
  }
  return 'light'
}

export function applyTheme(theme: 'light' | 'dark') {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = theme
}

export function setTheme(theme: 'light' | 'dark') {
  applyTheme(theme)
  if (typeof window !== 'undefined') {
    localStorage.setItem(THEME_KEY, theme)
  }
}
