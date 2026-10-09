/**
 * Status fields surfaced as badges on a record detail page.
 *
 * The list is DISPLAY ORDER, which is a presentation decision rather than a
 * schema fact, so it is declared here rather than derived. What is not
 * presentation is that these names must be real controlled fields: the
 * validator test asserts every entry has an allowed-value list, so the badge
 * list cannot drift away from the schema.
 *
 * Kept in its own module (not in the component) so a plain Node test can
 * import it without pulling in React or JSX.
 */
import { CONTROLLED_VALUES } from '../import/controlled-values'

export const STATUS_FIELDS: readonly { name: string; label: string }[] = [
  { name: 'match_status', label: 'Match status' },
  { name: 'eligibility_status', label: 'Eligibility' },
  { name: 'application_status', label: 'Application status' },
  { name: 'verification_status', label: 'Verification' },
  { name: 'profile_status', label: 'Profile status' },
  { name: 'record_status', label: 'Record status' },
  { name: 'priority', label: 'Priority' },
  { name: 'deadline_type', label: 'Deadline type' },
  // Phase 3 added notice_status and deferred bid_status to Phase 4. Both remain
  // last so every pre-existing badge keeps its position and order.
  { name: 'notice_status', label: 'Notice status' },
  // Phase 4. `bid_status` is only ONE of a Bid's three status axes; `eligibility_status`
  // already appears above from the funding list, and `bid_decision` is deliberately
  // NOT badged so the lifecycle status is not mistaken for the go/no-go decision.
  { name: 'bid_status', label: 'Bid status' },
]

/** Badge fields that exist on a given record type, in display order. */
export function statusFieldsFor(fieldNames: readonly string[]): { name: string; label: string }[] {
  const present = new Set(fieldNames)
  return STATUS_FIELDS.filter((f) => present.has(f.name))
}

/** Exported for the test that proves the list matches the schema. */
export const statusFieldNames = (): string[] => STATUS_FIELDS.map((f) => f.name)

/** True when every badge field has an allowed-value list. */
export const statusFieldsAreControlled = (): boolean =>
  STATUS_FIELDS.every((f) => Array.isArray(CONTROLLED_VALUES[f.name]))
