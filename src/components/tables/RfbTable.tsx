import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import RecordTable, { StatusCell } from './RecordTable'
import DeadlineBadge from '../records/DeadlineBadge'
import { IdBadge } from '../ui/Badges'
import {
  bidCountByNotice,
  filterNotices,
  noticesByDeadline,
  noticesByField,
  noticeDeadlineState,
  sortNotices,
  todayISO,
} from '../../data/procurement'
import type { DeadlineState } from '../../data/procurement'
import type { FilterDef } from './FilterBar'
import {
  field,
  listNotices,
  pathForRecord,
  procuringEntityForNotice,
  titleOf,
} from '../../data/selectors'
import { DEADLINE_FILTER_OPTIONS } from '../../data/procurement-options'
import { rfpDisplay } from '../vocabulary'

/**
 * RFP — a buyer's Request for Proposals, the procurement collection under its
 * user-facing name.
 *
 * This is demand-side procurement, not funding. There is no match score and no
 * eligibility verdict here: whether we may bid is a Bid question. Bid and
 * Contract are contextual subprocesses and appear as linked columns.
 */
export default function RfbTable({ headingAs = 'h2' }: { headingAs?: 'h1' | 'h2' }) {
  const today = todayISO()
  const notices = listNotices()
  const bidCounts = useMemo(() => bidCountByNotice(), [])
  // Deadline options carry their counts, so a reader can see that "Upcoming" is
  // empty before choosing it. The counts are over the whole collection and come
  // from the same classifier the filter applies, so an option can never disagree
  // with the rows it selects.
  const deadlineByState = noticesByDeadline(today)
  const deadlineOptions = DEADLINE_FILTER_OPTIONS.map((o) => ({
    ...o,
    count: deadlineByState[o.value as DeadlineState].length,
  }))

  const filters: FilterDef[] = [
    {
      key: 'noticeType',
      label: 'Type',
      hint: 'What kind of procurement the buyer published.',
      primary: true,
      options: noticesByField('notice_type').map((g) => ({ value: g.value, label: rfpDisplay(g.value) ?? g.value, count: g.count })),
    },
    {
      key: 'noticeStatus',
      label: 'Status',
      hint: 'The status the buyer itself recorded.',
      primary: true,
      options: noticesByField('notice_status').map((g) => ({ value: g.value, label: g.value, count: g.count })),
    },
    {
      key: 'deadline',
      label: 'Deadline',
      hint: `Deadlines compared with the reference date ${today}. Blank dates are "not recorded", never overdue.`,
      primary: true,
      options: deadlineOptions,
    },
    {
      key: 'procurementMethod',
      label: 'Method',
      hint: 'The procedure the buyer says it will follow.',
      category: 'Procedure & Bids',
      options: noticesByField('procurement_method').map((g) => ({ value: g.value, label: g.value, count: g.count })),
    },
    {
      key: 'lotStructure',
      label: 'Lot structure',
      hint: 'Whether the buyer described single or multiple lots.',
      category: 'Procedure & Bids',
      options: noticesByField('lot_structure').map((g) => ({ value: g.value, label: g.value, count: g.count })),
    },
    {
      key: 'bids',
      label: 'Bids',
      hint: 'Whether this RFP has a Bid record against it.',
      category: 'Procedure & Bids',
      options: [
        { value: 'with', label: 'Has bids', count: notices.filter((n) => (bidCounts[n.id] ?? 0) > 0).length },
        { value: 'without', label: 'No recorded bids', count: notices.filter((n) => (bidCounts[n.id] ?? 0) === 0).length },
      ],
    },
  ]

  return (
    <RecordTable
      title="RFP"
      headingAs={headingAs}
      description="Requests for Proposals published by buyers. Bid and Contract are the subprocesses that follow an RFP."
      records={notices}
      searchPlaceholder="Search name, ID, number, buyer…"
      filters={filters}
      urlFilters={['noticeType', 'procurementMethod', 'noticeStatus', 'lotStructure', 'deadline', 'bids']}
      sorts={[
        { key: 'deadline', label: 'Deadline (earliest, blanks last)' },
        { key: 'title', label: 'Title (A–Z)' },
        { key: 'buyer', label: 'Buyer (A–Z)' },
        { key: 'type', label: 'Type' },
        { key: 'id', label: 'ID' },
      ]}
      initialSort="deadline"
      filterRecords={(records, active) => {
        const keep = new Set(filterNotices(active, today).map((n) => n.id))
        return records.filter((r) => keep.has(r.id))
      }}
      sortRecords={(records, sortKey) =>
        sortNotices(
          records,
          sortKey === 'title'
            ? 'title'
            : sortKey === 'buyer'
              ? 'buyer'
              : sortKey === 'type'
                ? 'type'
                : sortKey === 'id'
                  ? 'id'
                  : 'deadline',
        )
      }
      columns={[
        {
          key: 'id',
          header: 'RFP',
          render: (r) => (
            <span className="recordlink">
              <IdBadge id={r.id} />
              <Link to={pathForRecord(r.id) ?? '#'} className="recordlink__name">
                {titleOf(r)}
              </Link>
            </span>
          ),
          search: (r) => {
            const buyer = procuringEntityForNotice(r.id)
            return `${r.id} ${titleOf(r)} ${String(field(r, 'notice_number') ?? '')} ${buyer?.id ?? ''} ${
              buyer ? titleOf(buyer) : ''
            }`
          },
        },
        {
          key: 'notice_type',
          header: 'Type',
          render: (r) => <StatusCell value={rfpDisplay(field(r, 'notice_type'))} />,
          search: (r) => String(field(r, 'notice_type') ?? ''),
        },
        {
          key: 'procuring_entity',
          header: 'Buyer',
          render: (r) => {
            const org = procuringEntityForNotice(r.id)
            return org ? (
              <Link to={pathForRecord(org.id) ?? '#'}>{org.id}</Link>
            ) : (
              <span className="value value--absent">not recorded</span>
            )
          },
        },
        {
          key: 'bids',
          header: 'Bids',
          render: (r) => {
            const n = bidCounts[r.id] ?? 0
            return n === 0 ? (
              <span className="value value--absent">none</span>
            ) : (
              <Link to={`/bids?notice=${r.id}`} className="countlink">
                {n} bid{n === 1 ? '' : 's'}
              </Link>
            )
          },
        },
        {
          key: 'bid_submission_deadline',
          header: 'Submission deadline',
          render: (r) => <DeadlineBadge date={field(r, 'bid_submission_deadline')} today={today} />,
          search: (r) => String(field(r, 'bid_submission_deadline') ?? ''),
        },
        {
          key: 'notice_status',
          header: 'Status',
          render: (r) => <StatusCell value={field(r, 'notice_status')} />,
          search: (r) => String(field(r, 'notice_status') ?? ''),
        },
      ]}
      filterExtra={
        <p className="filterbar__note">
          Deadlines are compared with <strong>{today}</strong>.{' '}
          {notices.filter((n) => noticeDeadlineState(n, today) === 'none_recorded').length} of {notices.length} RFPs
          have no recorded deadline.
        </p>
      }
    />
  )
}
