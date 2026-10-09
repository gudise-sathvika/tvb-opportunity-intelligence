/**
 * Top navigation: the only primary navigation in the application.
 *
 * There is deliberately no left sidebar anywhere. On desktop the links run
 * horizontally; below 860px they collapse into a toggled drawer, driven by the
 * same markup so there is one navigation to keep correct rather than two.
 */

import { useEffect, useState } from 'react'
import { NavLink, Link, useLocation } from 'react-router-dom'
import { primaryLink, supportingLinks, utilityDropdowns, workspaceDropdowns } from '../../app/nav'
import DropdownNav from './DropdownNav'
import ThemeToggle from '../ui/ThemeToggle'

function owns(pathname: string, path: string): boolean {
  const base = path.split('?')[0]
  return pathname === base || pathname.startsWith(`${base}/`)
}

export default function TopNav() {
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname, location.search])

  return (
    <header className="topnav">
      <div className="topnav__inner">
        <Link to="/" className="topnav__brand" aria-label="TVB Opportunity Intelligence">
          <span className="topnav__mark" aria-hidden="true" />
          <span className="topnav__brand-name">TVB Opportunity Intelligence</span>
        </Link>

        <button
          type="button"
          className="topnav__toggle"
          aria-expanded={menuOpen}
          aria-controls="primary-navigation"
          onClick={() => setMenuOpen((v) => !v)}
        >
          {menuOpen ? 'Close' : 'Menu'}
        </button>

        <nav
          className="topnav__links"
          id="primary-navigation"
          aria-label="Primary"
          data-open={menuOpen}
        >
          <NavLink
            to={primaryLink.to}
            end={primaryLink.end}
            className={({ isActive }) => `topnav__link${isActive ? ' topnav__link--active' : ''}`}
          >
            {primaryLink.label}
          </NavLink>

          {workspaceDropdowns.map((group) => (
            <div
              key={group.id}
              className="topnav__group"
              data-active={group.match.some((m) => owns(location.pathname, m)) ? 'true' : undefined}
            >
              <DropdownNav group={group} />
            </div>
          ))}

          {supportingLinks.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) => `topnav__link${isActive ? ' topnav__link--active' : ''}`}
            >
              {link.label}
            </NavLink>
          ))}

          {utilityDropdowns.map((group) => (
            <div
              key={group.id}
              className="topnav__group"
              data-active={group.match.some((m) => owns(location.pathname, m)) ? 'true' : undefined}
            >
              <DropdownNav group={group} />
            </div>
          ))}

          <div className="topnav__actions">
            <ThemeToggle />
          </div>
        </nav>
      </div>
    </header>
  )
}
