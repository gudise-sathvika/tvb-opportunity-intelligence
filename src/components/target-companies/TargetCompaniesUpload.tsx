import { useEffect, useRef, useState } from 'react'
import {
  parseTargetCompanyCsv,
  TARGET_COMPANY_ROW_MAX,
  TARGET_COMPANY_ROW_MIN,
  type CsvPreview,
} from '../../target-companies/csv'
import {
  clearImportedTargetCompanies,
  loadImportedTargetCompanies,
  saveImportedTargetCompanies,
  subscribeImportedTargetCompanies,
} from '../../target-companies/store'

export default function TargetCompaniesUpload({
  heading = 'Target Companies',
  importLabel = 'Upload CSV',
}: {
  heading?: string
  importLabel?: string
} = {}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [preview, setPreview] = useState<CsvPreview | null>(null)
  const [importing, setImporting] = useState(false)
  const [lastImportedSignature, setLastImportedSignature] = useState<string | null>(null)
  const fileTextRef = useRef<string | null>(null)
  const [imported, setImported] = useState<CsvPreview | null>(() => loadImportedTargetCompanies())
  const [importError, setImportError] = useState<string | null>(null)

  useEffect(
    () => subscribeImportedTargetCompanies(() => setImported(loadImportedTargetCompanies())),
    [],
  )

  const resetInput = () => {
    if (inputRef.current) inputRef.current.value = ''
  }

  const handleFile = async (file: File | null) => {
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setFileName(null)
      setPreview({
        headers: [],
        rows: [],
        rowCount: 0,
        errors: ['Only .csv files are accepted.'],
      })
      resetInput()
      return
    }
    try {
      const text = await file.text()
      fileTextRef.current = text
      const signature = `${file.name}:${text.length}:${simpleHash(text)}`
      setFileName(file.name)
      setPreview(parseTargetCompanyCsv(text))
      setLastImportedSignature((previous) => (previous === signature ? previous : null))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The selected file could not be read.'
      setFileName(null)
      setPreview({
        headers: [],
        rows: [],
        rowCount: 0,
        errors: [`File read failed: ${message}`],
      })
      resetInput()
    }
  }

  const clear = () => {
    setFileName(null)
    setPreview(null)
    resetInput()
  }

  const hasErrors = Boolean(preview && preview.errors.length > 0)
  const canShowTable = Boolean(preview) && preview!.headers.length > 0 && preview!.rows.length > 0
  const maxColumns = preview ? Math.max(preview.headers.length, ...preview.rows.map((row) => row.length), 0) : 0
  const extraColumnCount = preview ? Math.max(0, maxColumns - preview.headers.length) : 0

  return (
    <section className="page" aria-labelledby="target-companies-heading">
      <header className="page__header">
        <h2 className="page__title page__title--sub" id="target-companies-heading">
          {heading}
        </h2>
        <p className="page__description">
          Import a validated CSV of {TARGET_COMPANY_ROW_MIN}–{TARGET_COMPANY_ROW_MAX} companies. Imported
          records are saved in this browser and used in Discovery; the existing company directory is unchanged.
        </p>
      </header>

      <div className="target-companies__toolbar">
        <label className="btn" htmlFor="target-companies-csv">
          {importLabel}
          <input
            ref={inputRef}
            id="target-companies-csv"
            type="file"
            accept=".csv,text/csv"
            className="visually-hidden"
            onChange={(event) => {
              void handleFile(event.target.files?.[0] ?? null)
            }}
          />
        </label>
        <button type="button" className="btn" onClick={clear} disabled={!fileName && !preview}>
          Clear
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            if (preview && preview.errors.length === 0 && !importing) {
              const text = fileTextRef.current ?? ''
              const signature = `${fileName ?? ''}:${text.length}:${simpleHash(text)}`
              if (signature !== '' && signature === lastImportedSignature) {
                return
              }
              setImporting(true)
              setImportError(null)
              const saved = saveImportedTargetCompanies(preview)
              if (saved) {
                setImported(loadImportedTargetCompanies())
                setLastImportedSignature(signature)
              } else {
                setImportError('The CSV could not be saved in this browser. Your existing imported companies were not changed.')
              }
              setImporting(false)
            }
          }}
          disabled={!preview || preview.errors.length > 0 || importing}
        >
          {importing ? 'Importing...' : 'Confirm import'}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            if (clearImportedTargetCompanies()) {
              setImported(null)
              setImportError(null)
            } else {
              setImportError('The imported companies could not be removed from this browser.')
            }
          }}
          disabled={!imported}
        >
          Remove imported set
        </button>
        {fileName ? (
          <span className="target-companies__filename">
            Selected file: <strong>{fileName}</strong>
          </span>
        ) : null}
      </div>

      {preview ? (
        <p className="target-companies__status" role="status">
          {hasErrors
            ? 'CSV validation found errors. Existing imported companies are unchanged.'
            : `CSV validated: ${preview.rowCount} company record${preview.rowCount === 1 ? '' : 's'} ready to import.`}
        </p>
      ) : (
        <p className="target-companies__status" role="status">
          No CSV selected. Existing imported companies are preserved.
        </p>
      )}
      {importError !== null ? (
        <p className="target-companies__errors" role="alert">
          {importError}
        </p>
      ) : null}

      {preview && preview.errors.length > 0 ? (
        <div className="target-companies__errors" role="alert" aria-live="assertive">
          <p className="empty__headline">CSV validation failed</p>
          <ul>
            {preview.errors.map((message, index) => (
              <li key={index}>{message}</li>
            ))}
          </ul>
          <p className="empty__body">
            Expected {TARGET_COMPANY_ROW_MIN}–{TARGET_COMPANY_ROW_MAX} company records per CSV. Existing
            imported records are left unchanged.
          </p>
        </div>
      ) : null}

      {canShowTable ? (
        <div className="tablewrap">
          <table className="table">
            <caption className="visually-hidden">Companies from the selected CSV</caption>
            <thead>
              <tr>
                <th scope="col">Source row</th>
                {preview!.headers.map((header, index) => {
                  const normalized = header.trim().replace(/\\s+/g, ' ').toLocaleLowerCase()
                  const occurrence =
                    preview!.headers
                      .slice(0, index)
                      .filter((item) => item.trim().replace(/\\s+/g, ' ').toLocaleLowerCase() === normalized).length + 1
                  const duplicate = preview!.headers.filter((item) => item.trim().replace(/\\s+/g, ' ').toLocaleLowerCase() === normalized).length > 1
                  const label = header.trim() === '' ? `Column ${index + 1}` : duplicate ? `${header} (${occurrence})` : header
                  return (
                    <th key={`h-${index}`} scope="col" title={header}>
                      {label}
                    </th>
                  )
                })}
                {Array.from({ length: extraColumnCount }, (_, index) => (
                  <th key={`extra-${index}`} scope="col">
                    Extra {index + 1}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview!.rows.map((row, rowIndex) => {
                const isMalformed = row.length !== preview!.headers.length
                return (
                  <tr key={rowIndex} data-malformed={isMalformed ? 'true' : 'false'}>
                    <td data-label="Source row">{rowIndex + 2}</td>
                    {Array.from({ length: maxColumns }, (_, colIndex) => {
                      const value = row[colIndex]
                      const isMissing = value === undefined
                      const isEmpty = typeof value === 'string' && value.trim() === ''
                      const quality = isMalformed ? 'malformed' : isMissing || isEmpty ? 'missing' : 'supplied'
                      return (
                        <td
                          key={colIndex}
                          data-label={colIndex < preview!.headers.length ? preview!.headers[colIndex] : `Extra ${colIndex - preview!.headers.length + 1}`}
                          data-quality={quality}
                        >
                          {value ?? ''}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {canShowTable ? (
        <p className="target-companies__quality" role="note">
          Cell quality: supplied values are shown as entered; empty cells are missing/empty; rows with a
          different cell count than the header are marked malformed. Syntactic validation is not identity
          verification and does not establish company relevance.
        </p>
      ) : null}

      {imported ? (
        <p className="target-companies__status" role="status">
          Imported companies saved in this browser: {imported.rowCount}. The import is available after refresh,
          is not shared across users, and is not written to the production Vault.
        </p>
      ) : null}
    </section>
  )
}

function simpleHash(value: string): string {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i)
    hash |= 0
  }
  return String(hash)
}
