import { useMemo } from 'react'
import RecordListPage, { RecordLink, RelatedLinks, StatusCell } from '../components/tables/RecordTable'
import { matchFilters } from '../data/funding-options'
import { filterMatches } from '../data/funding-filters'
import { companyForMatch, field, listMatches, opportunityForMatch, titleOf } from '../data/selectors'

export default function MatchesPage() {
  const filters = useMemo(() => matchFilters(), [])

  return (
    <RecordListPage
      title="Matches"
      description="Pairings between a Company and an Opportunity that a reviewer assessed. A Match is a recorded assessment — not an application, not a bid."
      records={listMatches()}
      searchPlaceholder="Search name, ID, company, opportunity, rationale…"
      filters={filters}
      urlFilters={['matchStatus', 'eligibilityStatus', 'priority', 'hasApplication']}
      filterRecords={(records, active) => {
        const keep = new Set(
          filterMatches({
            matchStatus: active.matchStatus,
            eligibilityStatus: active.eligibilityStatus,
            priority: active.priority,
            hasApplication: active.hasApplication ? active.hasApplication === 'yes' : undefined,
          }).map((m) => m.id),
        )
        return records.filter((r) => keep.has(r.id))
      }}
      columns={[
        {
          key: 'id',
          header: 'Match',
          render: (r) => <RecordLink rec={r} />,
          search: (r) => `${r.id} ${titleOf(r)} ${field(r, 'match_rationale') ?? ''}`,
        },
        {
          key: 'company',
          header: 'Company',
          render: (r) => {
            const c = companyForMatch(r.id)
            return c ? <RelatedLinks ids={[c.id]} /> : <span className="value value--absent">not recorded</span>
          },
          search: (r) => companyForMatch(r.id)?.id ?? '',
        },
        {
          key: 'opportunity',
          header: 'Opportunity',
          render: (r) => {
            const o = opportunityForMatch(r.id)
            return o ? <RelatedLinks ids={[o.id]} /> : <span className="value value--absent">not recorded</span>
          },
          search: (r) => opportunityForMatch(r.id)?.id ?? '',
        },
        {
          key: 'match_status',
          header: 'Match status',
          render: (r) => <StatusCell value={field(r, 'match_status')} />,
        },
        {
          key: 'eligibility',
          header: 'Eligibility',
          render: (r) => <StatusCell value={field(r, 'eligibility_status')} />,
        },
        {
          key: 'priority',
          header: 'Priority',
          render: (r) => <StatusCell value={field(r, 'priority')} />,
        },
      ]}
    />
  )
}