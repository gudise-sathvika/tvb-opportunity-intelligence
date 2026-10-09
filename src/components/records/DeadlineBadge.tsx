/**
 * Deadline badge.
 *
 * Shows the recorded date and, separately, the arithmetic relationship between
 * that date and a stated reference day. Two things worth being explicit about:
 *
 * 1. A blank or malformed date renders as "not recorded", never as "past". The
 *    absence of a deadline is not an overdue deadline, and conflating the two
 *    would manufacture false alarms on the records whose author was honest
 *    about not knowing yet.
 * 2. The tone reuses the existing neutral palette rather than adding a red or
 *    green "overdue" colour. Whether a past deadline is bad is a judgement about
 *    the situation, not a fact about the date; the prototype states the fact and
 *    lets the reader judge.
 */

import { StatusBadge } from '../ui/Badges'
import type { BadgeTone } from '../ui/Badges'
import { DEADLINE_STATE_LABEL, classifyDeadline, isISODate } from '../../data/procurement'

/** Neutral tones only — see the note above. */
const STATE_TONE: Record<'upcoming' | 'past' | 'none_recorded', BadgeTone> = {
  upcoming: 'info',
  past: 'neutral',
  none_recorded: 'muted',
}

interface DeadlineBadgeProps {
  /** The raw stored value. Any non-ISO-2026 input is treated as unrecorded. */
  date: unknown
  /** The reference day the state is computed against, shown in the title. */
  today: string
}

/** The badge alone: the state word, without the date. */
export function DeadlineStateBadge({ date, today }: DeadlineBadgeProps) {
  const state = classifyDeadline(date, today)
  return (
    <StatusBadge
      label={DEADLINE_STATE_LABEL[state]}
      tone={STATE_TONE[state]}
      title={
        state === 'none_recorded'
          ? `No usable deadline recorded. Reference date ${today}.`
          : `Deadline ${String(date)} relative to reference date ${today}.`
      }
    />
  )
}

/** The date when one exists, with the state beside it. */
export default function DeadlineBadge({ date, today }: DeadlineBadgeProps) {
  if (!isISODate(date)) {
    return <DeadlineStateBadge date={date} today={today} />
  }
  return (
    <span className="deadline">
      <span className="deadline__date">{String(date)}</span>{' '}
      <DeadlineStateBadge date={date} today={today} />
    </span>
  )
}