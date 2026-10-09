/**
 * Application shell for every internal route.
 *
 * Composes the top navigation with the routed main region. There is no sidebar:
 * the shell is a vertical stack, header over content. Route changes move focus
 * to the page heading through one shared hook.
 */

import { useRef } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import TopNav from '../components/navigation/TopNav'
import WorkspaceBar from '../components/navigation/WorkspaceBar'
import { useRouteFocus } from '../hooks/useRouteFocus'

export default function AppShell() {
  const mainRef = useRef<HTMLElement>(null)
  const location = useLocation()
  useRouteFocus(mainRef)

  return (
    <div className="shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <TopNav />
      <WorkspaceBar />
      <main
        className="shell__main"
        id="main-content"
        tabIndex={-1}
        key={location.pathname}
        ref={mainRef}
      >
        <Outlet />
      </main>
    </div>
  )
}
