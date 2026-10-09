import { useLayoutEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

/**
 * Selector for the per-page heading. Every page renders exactly one
 * `<h1 className="page__title">`, so a single rule covers all routes without
 * each page having to opt in.
 */
const PAGE_HEADING = 'h1.page__title'

/** Remove the temporary tabindex without leaving an extra tab stop behind. */
function releaseTemporaryTabIndex(el: HTMLElement, remove: () => void) {
  el.addEventListener('blur', remove, { once: true })
}

/**
 * Moves focus to the new page after client-side navigation.
 *
 * A single-page app otherwise leaves focus wherever the old page left it, so a
 * keyboard or screen-reader user carries on from a link that no longer exists
 * and has no cue that the page changed.
 *
 * Behaviour:
 * - Runs only when the route path changes, so ordinary interactions such as
 *   typing in the search box never steal focus.
 * - Skips the very first render, so a normal page load is not hijacked.
 * - Prefers the page's `<h1>`, because that is what announces the new page
 *   context. Falls back to the container element if a page has no heading.
 * - Adds `tabindex="-1"` only for the duration of the focus, then removes it,
 *   so the heading never becomes a tab stop.
 * - Uses `preventScroll` so the browser's own scroll restoration still works.
 *
 * There is no focus loop: focusing cannot change the location, so this effect
 * cannot re-trigger itself.
 *
 * @param container Ref to the routed content element (the `<main>` region).
 */
export function useRouteFocus(container: React.RefObject<HTMLElement | null>) {
  const { pathname } = useLocation()
  const navigationType = useNavigationType()
  // Seeded with the current path, so the first effect run is a no-op. Seeding
  // with a "is this the first render?" flag is not safe: StrictMode invokes
  // effects twice and refs survive that simulated remount, which would let the
  // second run steal focus on a plain page load. Comparing the path instead
  // means only a genuine path change can move focus.
  const previousPath = useRef(pathname)

  useLayoutEffect(() => {
    // Initial load, or a re-render of the same route: nothing to do.
    if (pathname === previousPath.current) return
    previousPath.current = pathname

    const root = container.current
    if (!root) return

    const heading = root.querySelector<HTMLElement>(PAGE_HEADING)
    const target = heading ?? root

    // The container is always focusable already; a heading is not.
    const addedTabIndex = !target.hasAttribute('tabindex')
    if (addedTabIndex) {
      target.setAttribute('tabindex', '-1')
      releaseTemporaryTabIndex(target, () => target.removeAttribute('tabindex'))
    }

    target.focus({ preventScroll: true })

    // Scroll to the top for a fresh navigation, but leave POP alone so the
    // browser can restore the previous scroll position on back/forward.
    if (navigationType !== 'POP') {
      window.scrollTo(0, 0)
    }
  }, [pathname, navigationType, container])
}
