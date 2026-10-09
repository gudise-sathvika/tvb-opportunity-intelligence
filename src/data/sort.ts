import type { RecordRow } from '../types/records'
import { field, titleOf } from './selectors'

export interface SortOption {
  key: string
  label: string
}

/**
 * A deterministic sort over an existing field, for the list pages.
 *
 * Blank and absent values always sort last, in both directions, so "no value
 * recorded" never floats to the top and reads as the smallest date. Ties fall
 * back to the record ID, so the order is stable across renders.
 */
export function sortByField(
  rows: RecordRow[],
  fieldName: string,
  direction: 'asc' | 'desc' = 'asc',
): RecordRow[] {
  const read = (r: RecordRow) => {
    const v = field(r, fieldName)
    return typeof v === 'string' ? v : ''
  }
  return [...rows].sort((a, b) => {
    const av = read(a)
    const bv = read(b)
    if (av === '' && bv === '') return a.id.localeCompare(b.id)
    if (av === '') return 1
    if (bv === '') return -1
    const cmp = av.localeCompare(bv)
    if (cmp !== 0) return direction === 'asc' ? cmp : -cmp
    return a.id.localeCompare(b.id)
  })
}

/** Sort by the record's display title, blanks never occur because it falls back to the ID. */
export function sortByTitle(rows: RecordRow[]): RecordRow[] {
  return [...rows].sort((a, b) => titleOf(a).localeCompare(titleOf(b)) || a.id.localeCompare(b.id))
}
