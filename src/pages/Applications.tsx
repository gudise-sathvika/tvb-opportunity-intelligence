import { useMemo } from 'react'
import RecordListPage, { StatusCell } from '../components/tables/RecordTable'
import { IdBadge } from '../components/ui/Badges'
import { Link } from 'react-router-dom'
import {
  companyForApplication,
  field,
  listApplications,
  matchForApplication,
  opportunityForApplication,
  pathForRecord,
} from '../data/selectors'
import { applicationFilters } from '../data/funding-options'
import { filterApplications } from '../data/funding-filters'

export default function ApplicationsPage() {
  const filters = useMemo(() => applicationFilters(), [])

  return (
    <RecordListPage
      title="Applications"
      description="Application records. Applications are tracked here, not filed — there is no submission or status-changing capability."
      records={listApplications()}
      searchPlaceholder="Search ID, status, currency, next action…"
      filters={filters}
      urlFilters={['applicationStatus', 'hasSubmissionDate']}
      filterRecords={(records, active) => {
        const keep = new Set(
          filterApplications({
            applicationStatus: active.applicationStatus,
            hasSubmissionDate: active.hasSubmissionDate ? active.hasSubmissionDate === 'yes' : undefined,
          }).map((r) => r.id),
        )
        return records.filter((r) => keep.has(r.id))
      }}
      columns={[
        {
          key: 'id',
          header: 'Application',
          render: (r) => (
            <span className="recordlink">
              <IdBadge id={r.id} />
              <Link to={pathForRecord(r.id) ?? '#'} className="recordlink__name">
                {r.id}
              </Link>
            </span>
          ),
          search: (r) => r.id,
        },
        {
          key: 'company',
          header: 'Company',
          render: (r) => {
            const c = companyForApplication(r.id)
            return c ? (
              <Link to={pathForRecord(c.id) ?? '#'}>{c.id}</Link>
            ) : (
              <span className="value value--absent">not recorded</span>
            )
          },
        },
        {
          key: 'opportunity',
          header: 'Opportunity',
          render: (r) => {
            const o = opportunityForApplication(r.id)
            return o ? (
              <Link to={pathForRecord(o.id) ?? '#'}>{o.id}</Link>
            ) : (
              <span className="value value--absent">not recorded</span>
            )
          },
        },
        {
          key: 'status',
          header: 'Status',
          render: (r) => <StatusCell value={field(r, 'application_status')} />,
          search: (r) => String(field(r, 'application_status') ?? ''),
        },
        {
          key: 'deadline',
          header: 'Deadline',
          render: (r) => <StatusCell value={field(r, 'application_deadline')} />,
        },
        {
          key: 'requested',
          header: 'Requested',
          render: (r) => {
            const amt = field(r, 'requested_amount')
            const cur = field(r, 'requested_currency')
            if (amt === '') return <span className="value value--blank">(blank)</span>
            return (
              <span>
                {String(amt)} {String(cur || '')}
              </span>
            )
          },
        },
        {
          key: 'match',
          header: 'From match',
          render: (r) => {
            const m = matchForApplication(r.id)
            return m ? (
              <Link to={pathForRecord(m.id) ?? '#'}>{m.id}</Link>
            ) : (
              <span className="value value--absent">not recorded</span>
            )
          },
        },
      ]}
    />
  )
}
