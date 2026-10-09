/**
 * The boundary between recorded evidence and a human decision.
 */
export default function BoundaryNote({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`boundary-note${compact ? ' boundary-note--compact' : ''}`} role="note" aria-label="Automated and human steps">
      <p className="boundary-note__line">
        <span className="dg-chip dg-chip--completed">Automatic</span>
        imported records are shown as recorded; no proposal is inferred here.
      </p>
      <p className="boundary-note__line">
        <span className="dg-chip dg-chip--running">Human</span>
        approvals, rejections, and bid decisions require a recorded decision and are not
        automatically written to a record or vault file.
      </p>
    </div>
  )
}