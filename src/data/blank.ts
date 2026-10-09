/**
 * The single definition of "no value recorded".
 *
 * Blanks have to be representable in three places — a distribution bucket, a
 * filter option, and a table cell — and all three must agree on the wording. If
 * each layer invented its own string, a blank bucket labelled `(blank)` would
 * drill down to a filter option labelled "Not recorded" and appear to match
 * nothing.
 *
 * Defined at the lowest level because both `src/data` and `src/analytics` need it,
 * and `src/data` must not import from `src/analytics`.
 */

/** The label used wherever a field has no recorded value. */
export const BLANK = '(blank)'

/**
 * True when a frontmatter value counts as blank.
 *
 * Only a genuine non-empty string is a value. A number, a list, `null`, `''`, and
 * an absent field are all blank, which is what keeps `amount_max: 5000000` from
 * becoming a distribution category named "5000000".
 */
export function isBlankValue(v: unknown): boolean {
  return typeof v !== 'string' || v === ''
}