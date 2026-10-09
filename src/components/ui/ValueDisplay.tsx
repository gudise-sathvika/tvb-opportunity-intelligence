/**
 * Renders a single frontmatter value with its original state preserved.
 *
 * The three states are shown differently and are never merged:
 *   - blank string `""`  -> an explicit "(blank)" marker
 *   - empty list `[]`    -> an explicit "(empty list)" marker
 *   - absent key         -> an explicit "(not recorded)" marker
 *   - `false`            -> shown as "false", never as blank
 *   - `0`                -> shown as "0", never as blank
 */

export function ValueDisplay({ value }: { value: unknown }) {
  if (value === undefined) {
    return <span className="value value--absent">(not recorded)</span>
  }
  if (value === '') {
    return (
      <span className="value value--blank" title="Present in the record, deliberately empty">
        (blank)
      </span>
    )
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return (
        <span className="value value--blank" title="Present in the record, empty list">
          (empty list)
        </span>
      )
    }
    return (
      <ul className="valuelist">
        {value.map((item, i) => (
          <li key={i}>{String(item)}</li>
        ))}
      </ul>
    )
  }
  if (value === false) return <span className="value">false</span>
  if (value === 0) return <span className="value">0</span>
  return <span className="value">{String(value)}</span>
}
