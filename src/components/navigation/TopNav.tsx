/**
 * Top navigation: the only primary navigation in the application.
 *
 * There is deliberately no left sidebar anywhere. On desktop the links run
 * horizontally; below 860px they collapse into a toggled drawer, driven by the
 * same markup so there is one navigation to keep correct rather than two.
 */

import { useEffect, useState } from 'react'
import { NavLink, Link, useLocation } from 'react-router-dom'
import { primaryLink, supportingLinks } from '../../app/nav'
import ThemeToggle from '../ui/ThemeToggle'

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
          <span className="topnav__brand-wrap">
            <span className="topnav__brand-name">TVB</span>
            <span className="topnav__brand-sub">Opportunity Intelligence</span>
          </span>
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

          {supportingLinks.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) => `topnav__link${isActive ? ' topnav__link--active' : ''}`}
            >
              {link.label}
            </NavLink>
          ))}

          <NavLink
            to="/history"
            className={({ isActive }) => `topnav__link${isActive ? ' topnav__link--active' : ''}`}
          >
            Run History
          </NavLink>

          <NavLink
            to="/logs"
            className={({ isActive }) => `topnav__link${isActive ? ' topnav__link--active' : ''}`}
          >
            Logs
          </NavLink>

          <div className="topnav__actions">
            <ThemeToggle />
          </div>
        </nav>
      </div>
    </header>
  )
}
