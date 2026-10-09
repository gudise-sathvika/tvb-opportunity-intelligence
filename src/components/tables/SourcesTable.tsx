import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import RecordTable, { StatusCell } from './RecordTable'
import { IdBadge } from '../ui/Badges'
import { sourceFilters } from '../../data/funding-options'
import { filterSources } from '../../data/funding-filters'
import { sortByField, sortByTitle } from '../../data/sort'
import { field, listSources, opportunityForSource, pathForRecord, titleOf } from '../../data/selectors'

/**
 * Sources — provenance and evidence.
 *
 * A Source is the recorded origin of a claim about a linked opportunity, not an
 * independent verification. The link comes from `related_opportunity`, never
 * from matching URLs.
 */
export default function SourcesTable({ headingAs = 'h1' }: { headingAs?: 'h1' | 'h2' }) {
  const filters = useMemo(() => sourceFilters(), [])

  return (
    <RecordTable
      title="Sources"
      headingAs={headingAs}
      description="Provenance for the records they support: where a claim came from, when it was last checked, and which Grant it supports."
      records={listSources()}
      searchPlaceholder="Search name, ID, type…"
      filters={filters}
      urlFilters={['sourceType', 'hasLastChecked']}
      sorts={[
        { key: 'title', label: 'Name (A–Z)' },
        { key: 'type', label: 'Type' },
        { key: 'last_checked', label: 'Last checked (earliest, blanks last)' },
        { key: 'id', label: 'ID' },
      ]}
      initialSort="title"
      filterRecords={(records, active) => {
        const keep = new Set(
          filterSources({
            sourceType: active.sourceType,
            hasLastChecked: active.hasLastChecked ? active.hasLastChecked === 'yes' : undefined,
          }).map((r) => r.id),
        )
        return records.filter((r) => keep.has(r.id))
      }}
      sortRecords={(records, key) => {
        if (key === 'type') return sortByField(records, 'source_type')
        if (key === 'last_checked') return sortByField(records, 'last_checked')
        if (key === 'id') return [...records].sort((a, b) => a.id.localeCompare(b.id))
        return sortByTitle(records)
      }}
      columns={[
        {
          key: 'id',
          header: 'Source',
          render: (r) => (
            <span className="recordlink">
              <IdBadge id={r.id} />
              <Link to={pathForRecord(r.id) ?? '#'} className="recordlink__name">
                {titleOf(r)}
              </Link>
            </span>
          ),
          search: (r) => `${r.id} ${titleOf(r)}`,
        },
        {
          key: 'type',
          header: 'Type',
          render: (r) => <StatusCell value={field(r, 'source_type')} />,
          search: (r) => String(field(r, 'source_type') ?? ''),
        },
        {
          key: 'opportunity',
          header: 'Related Grant',
          render: (r) => {
            const o = opportunityForSource(r.id)
            return o ? (
              <Link to={pathForRecord(o.id) ?? '#'}>{o.id}</Link>
            ) : (
              <span className="value value--absent">not recorded</span>
            )
          },
        },
        {
          key: 'last_checked',
          header: 'Last checked',
          render: (r) => <StatusCell value={field(r, 'last_checked')} />,
        },
        {
          key: 'url',
          header: 'URL',
          render: (r) => {
            const u = field(r, 'source_url')
            if (typeof u !== 'string' || u === '') {
              return <span className="value value--blank">(blank)</span>
            }
            return (
              <a href={u} target="_blank" rel="noreferrer noopener" className="urllink">
                {u.replace(/^https?:\/\//, '').slice(0, 48)}
              </a>
            )
          },
        },
      ]}
    />
  )
}
