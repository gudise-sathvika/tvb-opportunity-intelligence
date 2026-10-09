import { useMemo } from 'react'
import RecordTable, { RecordLink, RelatedLinks, StatusCell } from './RecordTable'
import { opportunityFilters } from '../../data/funding-options'
import { filterOpportunities } from '../../data/funding-filters'
import { sortByField, sortByTitle } from '../../data/sort'
import {
  applicationsForOpportunity,
  field,
  listOpportunities,
  matchesForOpportunity,
  titleOf,
} from '../../data/selectors'
import type { RecordRow } from '../../types/records'

/** The sort keys the Grants list offers. Every key maps to a real field. */
export const GRANT_SORTS = [
  { key: 'deadline', label: 'Deadline (earliest, blanks last)' },
  { key: 'title', label: 'Title (A–Z)' },
  { key: 'type', label: 'Grant type' },
  { key: 'country', label: 'Country' },
  { key: 'id', label: 'ID' },
]

export function sortGrants(rows: RecordRow[], key: string): RecordRow[] {
  switch (key) {
    case 'title':
      return sortByTitle(rows)
    case 'type':
      return sortByField(rows, 'opportunity_type')
    case 'country':
      return sortByField(rows, 'country')
    case 'id':
      return [...rows].sort((a, b) => a.id.localeCompare(b.id))
    case 'deadline':
    default:
      return sortByField(rows, 'application_deadline')
  }
}

/**
 * Grants — the funding collection under its user-facing name.
 *
 * The records are Opportunities; the page calls them Grants because that is the
 * reader's word for them. Match and Application are contextual subprocesses, so
 * they appear as linked columns here rather than as separate navigation.
 */
export default function GrantsTable({ headingAs = 'h2' }: { headingAs?: 'h1' | 'h2' }) {
  const filters = useMemo(() => opportunityFilters(), [])

  return (
    <RecordTable
      title="Grants"
      headingAs={headingAs}
      description="Funding programmes recorded in the vault, shown as Grants. Match and Application are the subprocesses that follow a Grant."
      records={listOpportunities()}
      searchPlaceholder="Search name, ID, country, provider…"
      filters={filters}
      urlFilters={['opportunityType', 'verificationStatus', 'recordStatus', 'country', 'hasDeadline']}
      sorts={GRANT_SORTS}
      initialSort="deadline"
      filterRecords={(records, active) => {
        const keep = new Set(
          filterOpportunities({
            opportunityType: active.opportunityType,
            verificationStatus: active.verificationStatus,
            recordStatus: active.recordStatus,
            country: active.country,
            hasDeadline: active.hasDeadline ? active.hasDeadline === 'yes' : undefined,
          }).map((o) => o.id),
        )
        return records.filter((r) => keep.has(r.id))
      }}
      sortRecords={sortGrants}
      columns={[
        {
          key: 'id',
          header: 'Grant',
          render: (r) => <RecordLink rec={r} />,
          search: (r) => `${r.id} ${titleOf(r)} ${field(r, 'country') ?? ''}`,
        },
        {
          key: 'type',
          header: 'Grant type',
          render: (r) => <StatusCell value={field(r, 'opportunity_type')} />,
          search: (r) => String(field(r, 'opportunity_type') ?? ''),
        },
        {
          key: 'matches',
          header: 'Matches',
          render: (r) => <RelatedLinks ids={matchesForOpportunity(r.id).map((m) => m.id)} />,
          search: (r) => matchesForOpportunity(r.id).map((m) => m.id).join(' '),
        },
        {
          key: 'applications',
          header: 'Applications',
          render: (r) => <RelatedLinks ids={applicationsForOpportunity(r.id).map((a) => a.id)} />,
          search: (r) => applicationsForOpportunity(r.id).map((a) => a.id).join(' '),
        },
        {
          key: 'verification',
          header: 'Verification',
          render: (r) => <StatusCell value={field(r, 'verification_status')} />,
          search: (r) => String(field(r, 'verification_status') ?? ''),
        },
        {
          key: 'country',
          header: 'Country',
          render: (r) => <StatusCell value={field(r, 'country')} />,
          search: (r) => String(field(r, 'country') ?? ''),
        },
        {
          key: 'deadline',
          header: 'Application deadline',
          render: (r) => <StatusCell value={field(r, 'application_deadline')} />,
        },
      ]}
    />
  )
}
