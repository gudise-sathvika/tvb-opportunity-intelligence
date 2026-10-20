/**
 * Local, dependency-free CSV parsing and validation for imported target companies.
 *
 * Header and row checks are intentionally kept separate from record mapping;
 * validated rows are converted to company profiles by the target-company layer.
 */

export const TARGET_COMPANY_ROW_MIN = 5
export const TARGET_COMPANY_ROW_MAX = 10

export interface CsvPreview {
  /** Detected header row (may be empty when the file could not be parsed). */
  headers: string[]
  /** Parsed data rows, in file order. Never silently discarded. */
  rows: string[][]
  /** Number of data rows. */
  rowCount: number
  /** Human-readable validation errors. Empty when the preview is valid. */
  errors: string[]
}

/** Parse a CSV document into an array of string rows. Throws on unterminated quotes. */
export function parseCsvDocument(text: string): string[][] {
  const input = text.replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let atFieldStart = true
  let ended = false

  const pushField = () => {
    row.push(field)
    field = ''
    atFieldStart = true
  }
  const pushRow = () => {
    // Only emit a row if it is not a trailing empty artifact of a final newline.
    if (row.length === 0 && field === '' && rows.length > 0 && atFieldStart) {
      // trailing empty line; skip artifact
    } else {
      rows.push(row)
    }
    row = []
    field = ''
    atFieldStart = true
  }

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
      continue
    }
    if (ch === '"') {
      if (!atFieldStart && field !== '') {
        // quote in the middle of an unquoted field: treat literally
        field += ch
      } else {
        inQuotes = true
        atFieldStart = false
      }
      continue
    }
    if (ch === ',') {
      pushField()
      atFieldStart = true
      continue
    }
    if (ch === '\n') {
      pushField()
      pushRow()
      ended = true
      continue
    }
    if (ch === '\r') {
      // handle CRLF
      if (input[i + 1] === '\n') continue
      pushField()
      pushRow()
      ended = true
      continue
    }
    field += ch
    atFieldStart = false
    ended = false
  }

  // final field/row
  if (inQuotes) {
    throw new Error('Unterminated quoted field in CSV.')
  }
  // Emit trailing content unless the document ended exactly on a newline and
  // there is no leftover field/row content.
  const hasTrailingContent = field !== '' || row.length > 0 || !ended
  if (hasTrailingContent) {
    pushField()
    // Avoid emitting a spurious empty trailing row from a final newline.
    const isEmptyRow = row.length === 1 && row[0] === '' && field === ''
    if (!(isEmptyRow && rows.length > 0 && input.endsWith('\n'))) {
      rows.push(row)
    }
  }

  return rows
}

/**
 * Conservative identity-field classification.
 *
 * Only exact, known identity headers are treated as possible company identifiers.
 * Ordinary descriptive fields such as headquarters, sector, country, or other
 * descriptive attributes are intentionally excluded so shared descriptive
 * values are not mistaken for duplicate companies.
 */
const IDENTITY_HEADERS = new Set([
  'company',
  'company name',
  'legal name',
  'registered name',
  'organization name',
  'company url',
  'url',
  'website',
  'website url',
  'domain',
  'email',
  'company email',
  'company id',
  'id',
  'registration number',
  'company registration number',
  'lei',
  'company identifier',
])

function normalizeHeaderForComparison(header: string): string {
  return header.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

function isIdentityHeader(header: string): boolean {
  return IDENTITY_HEADERS.has(normalizeHeaderForComparison(header))
}

export function parseTargetCompanyCsv(text: string): CsvPreview {
  const errors: string[] = []
  let document: string[][]

  if (text.trim() === '') {
    return { headers: [], rows: [], rowCount: 0, errors: ['The CSV file is empty.'] }
  }

  try {
    document = parseCsvDocument(text)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The CSV file could not be parsed.'
    return { headers: [], rows: [], rowCount: 0, errors: [message] }
  }

  // Remove completely empty trailing rows that are artifacts, but keep any
  // blank rows in the middle so they are reported as malformed rather than
  // silently dropped.
  const cleaned: string[][] = [...document]
  while (
    cleaned.length > 0 &&
    cleaned[cleaned.length - 1].length === 1 &&
    cleaned[cleaned.length - 1][0].trim() === '' &&
    cleaned[cleaned.length - 1].every((c) => c.trim() === '')
  ) {
    // only drop if the entire row is empty
    cleaned.pop()
  }

  if (cleaned.length === 0) {
    return { headers: [], rows: [], rowCount: 0, errors: ['The CSV file is empty.'] }
  }

  const headers = cleaned[0].map((h) => h.trim())
  const dataRows = cleaned.slice(1)

  // Header validation: blank and duplicate headers are reported using a
  // comparison form, while the original header text and column position are
  // preserved in the returned preview.
  const blankHeaderColumns: number[] = []
  headers.forEach((header, index) => {
    if (header.trim() === '') blankHeaderColumns.push(index + 1)
  })
  if (blankHeaderColumns.length > 0) {
    errors.push(
      `Blank header${blankHeaderColumns.length === 1 ? '' : 's'} at column${blankHeaderColumns.length === 1 ? '' : 's'} ${blankHeaderColumns.join(', ')}.`,
    )
  }

  const headerPositions = new Map<string, number[]>()
  headers.forEach((header, index) => {
    const key = normalizeHeaderForComparison(header)
    if (key === '') return
    const positions = headerPositions.get(key) ?? []
    positions.push(index + 1)
    headerPositions.set(key, positions)
  })
  for (const [normalized, positions] of headerPositions) {
    if (positions.length > 1) {
      const original = headers[positions[0] - 1]
      errors.push(
        `Duplicate header "${original}" at columns ${positions.join(' and ')} (comparison key "${normalized}").`,
      )
    }
  }

  // Malformed / inconsistent rows
  const expected = headers.length
  // Pad short rows with empty trailing fields (common when a final empty cell
  // is omitted) instead of treating them as malformed. Only rows with more
  // columns than the header are considered malformed.
  const normalizedRows = dataRows.map((r) => {
    if (r.length >= expected) return r
    return [...r, ...Array.from({ length: expected - r.length }, () => '')]
  })

  const malformed: number[] = []
  dataRows.forEach((r, idx) => {
    if (r.length > expected) malformed.push(idx + 2) // 1-based data row + header
  })
  if (malformed.length > 0) {
    const details = malformed
      .map((rowNumber) => `row ${rowNumber} has ${dataRows[rowNumber - 2].length} columns`)
      .join('; ')
    errors.push(
      `Malformed row${malformed.length === 1 ? '' : 's'}: ${details}; expected ${expected} column${expected === 1 ? '' : 's'}.`,
    )
  }

  // Duplicate exact rows
  const seenRows = new Map<string, number[]>()
  normalizedRows.forEach((r, idx) => {
    const key = JSON.stringify(r)
    const list = seenRows.get(key) ?? []
    list.push(idx + 2)
    seenRows.set(key, list)
  })
  for (const positions of seenRows.values()) {
    if (positions.length > 1) {
      errors.push(`Duplicate record detected: rows ${positions.join(' and ')} are identical.`)
    }
  }

  // Duplicate values in identifier-like columns
  headers.forEach((header, colIdx) => {
    if (!isIdentityHeader(header)) return
    const valuePositions = new Map<string, number[]>()
    normalizedRows.forEach((r, idx) => {
      const value = (r[colIdx] ?? '').trim()
      if (value === '') return
      const list = valuePositions.get(value.toLocaleLowerCase()) ?? []
      list.push(idx + 2)
      valuePositions.set(value.toLocaleLowerCase(), list)
    })
    for (const [value, positions] of valuePositions) {
      if (positions.length > 1) {
        errors.push(
        `Possible duplicate value "${value}" in identity field "${header}" (rows ${positions.join(', ')}). This is a review warning, not proof that those rows represent the same company or legal entity.`,
      )
      }
    }
  })

  // Row count 5-10
  if (dataRows.length < TARGET_COMPANY_ROW_MIN || dataRows.length > TARGET_COMPANY_ROW_MAX) {
    errors.push(
      `Expected ${TARGET_COMPANY_ROW_MIN}–${TARGET_COMPANY_ROW_MAX} company records, but found ${dataRows.length}.`,
    )
  }

  // If there are no data rows at all
  if (dataRows.length === 0) {
    errors.push('CSV contains a header row but no data rows.')
  }

  return {
    headers,
    rows: normalizedRows,
    rowCount: dataRows.length,
    errors,
  }
}