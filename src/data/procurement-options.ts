/**
 * Shared option lists for the procurement filters.
 *
 * Kept in one place so the Notices and Bids pages cannot drift into offering
 * different labels for the same deadline state.
 */

import type { SelectOption } from '../components/tables/FilterBar'
import { DEADLINE_STATE_LABEL } from './procurement'
import type { DeadlineState } from './procurement'

/**
 * Deadline-state filter values.
 *
 * The labels are taken from `DEADLINE_STATE_LABEL` rather than retyped, because
 * these were previously a hand-written parallel list that had already drifted
 * from the badge wording — the filter said "Not recorded" while the badge said
 * "No deadline recorded". Deriving them makes that impossible.
 *
 * `''` means "all" and is rendered separately by the filter bar.
 */
export const DEADLINE_FILTER_OPTIONS: SelectOption[] = (Object.keys(DEADLINE_STATE_LABEL) as DeadlineState[]).map(
  (state) => ({ value: state, label: DEADLINE_STATE_LABEL[state] }),
)

/** Filter value meaning "make no restriction on this dimension". */
export const ANY = 'any'