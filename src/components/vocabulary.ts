/**
 * User-facing vocabulary overrides.
 *
 * The procurement request is stored as `RFB` wherever it is a schema value or
 * an identifier, but every place that value reaches the interface is shown as
 * RFP — the product's display term (Phase Y). Record IDs, stored values, filter
 * values, and URLs are never rewritten: this helper is display-only and is
 * applied at render sites.
 */
export function rfpDisplay(value: string | null | undefined): string | null | undefined
export function rfpDisplay(value: unknown): unknown
export function rfpDisplay(value: unknown): unknown {
  return value === 'RFB' ? 'RFP' : value
}
