import { Link } from 'react-router-dom'

/**
 * A small contextual back control.
 *
 * A real link to the parent collection rather than a history-based button, so it
 * is keyboard reachable, focusable, follows the same URL-carrying principle as
 * the rest of the navigation, and is shareable/bookmarkable. The arrow is
 * decorative and hidden from assistive technology; the link's own text is the
 * accessible name. Kept deliberately small so it never competes with the page
 * title it sits above.
 */
export default function BackNavigation({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="backlink">
      <svg
        className="backlink__arrow"
        width="14"
        height="14"
        viewBox="0 0 16 16"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="M10 3 5 8l5 5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      Back to {label}
    </Link>
  )
}
