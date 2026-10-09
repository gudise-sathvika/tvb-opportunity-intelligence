import { useMemo } from 'react'
import RecordTable, { RecordLink, RelatedLinks, StatusCell } from './RecordTable'
import { organizationFilters } from '../../data/funding-options'
import { filterOrganizations } from '../../data/funding-filters'
import { sortByField, sortByTitle } from '../../data/sort'
import {
  field,
  listOrganizations,
  noticesForOrganization,
  opportunitiesForOrganization,
  titleOf,
} from '../../data/selectors'

export default function OrganizationsTable({ headingAs = 'h1' }: { headingAs?: 'h1' | 'h2' }) {
  const filters = useMemo(() => organizationFilters(), [])

  return (
    <RecordTable
      title="Organizations"
      headingAs={headingAs}
      description="Government bodies, institutions, and agencies. An Organization's role is derived from the records that link to it, not assumed for the whole collection."
      records={listOrganizations()}
      searchPlaceholder="Search name, ID, country, type…"
      filters={filters}
      urlFilters={['organizationType', 'country']}
      sorts={[
        { key: 'title', label: 'Name (A–Z)' },
        { key: 'type', label: 'Type' },
        { key: 'country', label: 'Country' },
        { key: 'id', label: 'ID' },
      ]}
      initialSort="title"
      filterRecords={(records, active) => {
        const keep = new Set(
          filterOrganizations({
            organizationType: active.organizationType,
            country: active.country,
          }).map((o) => o.id),
        )
        return records.filter((r) => keep.has(r.id))
      }}
      sortRecords={(records, key) => {
        if (key === 'type') return sortByField(records, 'organization_type')
        if (key === 'country') return sortByField(records, 'country')
        if (key === 'id') return [...records].sort((a, b) => a.id.localeCompare(b.id))
        return sortByTitle(records)
      }}
      columns={[
        {
          key: 'id',
          header: 'Organization',
          render: (r) => <RecordLink rec={r} />,
          search: (r) => `${r.id} ${titleOf(r)}`,
        },
        {
          key: 'type',
          header: 'Type',
          render: (r) => <StatusCell value={field(r, 'organization_type')} />,
          search: (r) => String(field(r, 'organization_type') ?? ''),
        },
        {
          key: 'country',
          header: 'Country',
          render: (r) => <StatusCell value={field(r, 'country')} />,
          search: (r) => String(field(r, 'country') ?? ''),
        },
        {
          key: 'opportunities',
          header: 'Grants provided',
          render: (r) => <RelatedLinks ids={opportunitiesForOrganization(r.id).map((o) => o.id)} />,
          search: (r) => opportunitiesForOrganization(r.id).map((o) => o.id).join(' '),
        },
        {
          key: 'notices',
          header: 'RFPs issued',
          render: (r) => <RelatedLinks ids={noticesForOrganization(r.id).map((n) => n.id)} />,
          search: (r) => noticesForOrganization(r.id).map((n) => n.id).join(' '),
        },
        {
          key: 'website',
          header: 'Website',
          render: (r) => {
            const w = field(r, 'website')
            if (typeof w !== 'string' || w === '') {
              return <span className="value value--blank">(blank)</span>
            }
            return (
              <a href={w} target="_blank" rel="noreferrer noopener">
                {w}
              </a>
            )
          },
        },
      ]}
    />
  )
}
