/**
 * Renders a field value that may contain wikilinks.
 *
 * A `[[...]]` link becomes navigable when it resolves to a record or a note in
 * the snapshot. The original `[[...]]` text is always shown alongside, so no
 * information is hidden by the link rendering. An unresolvable link is shown
 * as plain text, marked as not resolved.
 */

import { Link } from 'react-router-dom'
import { getRecord, linkLabel, pathForRecord } from '../../data/selectors'
import type { LinkTarget } from '../../types/records'

export default function WikilinkField({ links }: { links: LinkTarget[] }) {
  if (links.length === 0) {
    return (
      <span className="value value--blank" title="Present in the record, deliberately empty">
        (blank)
      </span>
    )
  }
  return (
    <ul className="valuelist valuelist--links">
      {links.map((l, i) => {
        const rec = l.resolvedId ? getRecord(l.resolvedId) : undefined
        const path = rec && l.resolvedId ? pathForRecord(l.resolvedId) : null
        const label = linkLabel(l.raw)
        return (
          <li key={i}>
            {path ? (
              <Link to={path} className="wikilink">
                {label}
              </Link>
            ) : (
              <span className="wikilink wikilink--unresolved" title="Does not resolve to a record in this snapshot">
                {label}
              </span>
            )}
            <code className="wikilink__raw">{l.raw}</code>
            {!rec && l.notePath ? (
              <span className="wikilink__note" title="Links to a documentation note, not a record">
                note: {l.notePath}
              </span>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
