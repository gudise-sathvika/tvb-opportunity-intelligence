/**
 * Status and provenance badges.
 *
 * The label is always the ORIGINAL value from the snapshot, verbatim. Colour
 * is neutral and derived only from the value's own text, so a record never
 * looks approved or recommended because of ordering or a lucky colour.
 *
 * There is deliberately no "good"/"bad" green/red mapping: `Verified` and
 * `Ineligible` are both plain tones here, because neither is an independent
 * approval decision.
 */

export type BadgeTone = 'neutral' | 'muted' | 'info'

const TONES: Record<BadgeTone, string> = {
  neutral: 'badge--neutral',
  muted: 'badge--muted',
  info: 'badge--info',
}

interface BadgeProps {
  label: string
  tone?: BadgeTone
  title?: string
}

/** A status value, rendered exactly as stored. */
export function StatusBadge({ label, tone = 'neutral', title }: BadgeProps) {
  return (
    <span className={`badge ${TONES[tone]}`} title={title}>
      {label}
    </span>
  )
}

/** The ID chip, which is also the stable join key shown to the reader. */
export function IdBadge({ id }: { id: string }) {
  return (
    <span className="idbadge" title="Record ID (stable join key)">
      {id}
    </span>
  )
}
