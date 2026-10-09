/**
 * Dropdown navigation group.
 *
 * A disclosure button that opens a menu of links. It closes on outside click,
 * on Escape, and after a navigation. The button carries `aria-expanded` and
 * `aria-haspopup`, and the menu is a labelled list of real links, so it is
 * operable by keyboard and understands as navigation rather than as a form.
 */

import { useEffect, useId, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import type { NavDropdown } from '../../app/nav'

export default function DropdownNav({ group }: { group: NavDropdown }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="dropdown" ref={wrapRef}>
      <button
        type="button"
        className="topnav__link"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
      >
        {group.label}
        <span aria-hidden="true">▾</span>
      </button>
      <div className="dropdown__menu" id={menuId} data-open={open} role="menu">
        {group.items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              isActive ? 'dropdown__item dropdown__item--active' : 'dropdown__item'
            }
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            <span className="dropdown__item-title">{item.label}</span>{' '}
            <span className="dropdown__item-desc">{item.description}</span>
          </NavLink>
        ))}
      </div>
    </div>
  )
}
