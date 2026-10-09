import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import RecordListPage, { RelatedLinks, StatusCell } from '../components/tables/RecordTable'
import DeadlineBadge from '../components/records/DeadlineBadge'
import { IdBadge } from '../components/ui/Badges'
import { Link } from 'react-router-dom'
import type { FilterDef } from '../components/tables/FilterBar'
import { DEADLINE_FILTER_OPTIONS } from '../data/procurement-options'
import {
  bidsByAxis,
  filterBids,
  sortBids,
  todayISO,
} from '../data/procurement'
import {
  companyForBid,
  companiesWithBids,
  contractsForBid,
  field,
  listBids,
  listNotices,
  noticeForBid,
  pathForRecord,
  titleOf,
} from '../data/selectors'

/**
 * Bids — one company's pursuit of one procurement notice.
 *
 * This is the supply side of procurement: a Notice is what a buyer published, a
 * Bid is what we did about it. The columns are the three independent axes, kept
 * side by side on purpose. There is deliberately no single "status" column and no
 * combined verdict, because `Potentially eligible` + `Preparing` + `Bid` is a
 * normal state and collapsing the three would hide which one is unresolved.
 *
 * Nothing here computes a win rate, a bid total, or an attractiveness score. The
 * snapshot cannot support one, and Phase 1 risk O5 explicitly refuses a
 * `match_score` equivalent for procurement.
 *
 * Phase 5 adds one filter per axis, plus filters for the company and the notice
 * being pursued. Filtering by one axis never implies a value on another: choosing
 * `Submitted` does not silently restrict eligibility, because a bid's submitted
 * state says nothing about whether we were eligible.
 *
 * The Contracts column is the post-award step of the workflow: the contracts that
 * came out of this bid, where they exist, resolved from the record ID. A bid that
 * did not reach award shows `none`, because producing nothing is a fact about the
 * bid rather than missing data.
 */
export default function Bids() {
  const today = todayISO()
  const bids = listBids()

  // The Notices and Company pages link here with ?notice= or ?company= so a
  // reader who asked "show me the bids against this tender" or "this company's
  // bids" lands already filtered. Reading the query here rather than redirecting
  // keeps the result visible on the page and clearable in place.
  const [params, setParams] = useSearchParams()
  const presetNotice = params.get('notice') ?? ''
  const presetCompany = params.get('company') ?? ''

  const axisOptions = (axis: 'eligibility_status' | 'bid_decision' | 'bid_status') =>
    bidsByAxis(bids, axis)
      .filter((g) => g.count > 0)
      .map((g) => ({ value: g.value, label: g.value, count: g.count }))

  const filters: FilterDef[] = useMemo(
    () => [
      {
        key: 'eligibility',
        label: 'Eligibility',
        hint: 'Axis 1: whether we may bid, from eligibility review. Independent of the other two axes.',
        primary: true,
        options: axisOptions('eligibility_status'),
      },
      {
        key: 'decision',
        label: 'Decision',
        hint: 'Axis 2: our go/no-go choice. Independent of eligibility and of bid status.',
        primary: true,
        options: axisOptions('bid_decision'),
      },
      {
        key: 'status',
        label: 'Bid status',
        hint: 'Axis 3: where the bid stands in its lifecycle. Independent of the other two axes.',
        primary: true,
        options: axisOptions('bid_status'),
      },
      {
        key: 'companyId',
        label: 'Company',
        hint: 'The company doing the pursuing.',
        category: 'Tender & Entity',
        options: companiesWithBids().map((c) => ({ value: c.id, label: `${c.id} — ${titleOf(c)}` })),
      },
      {
        key: 'noticeId',
        label: 'Notice',
        hint: 'The procurement notice this bid answers.',
        category: 'Tender & Entity',
        options: listNotices().map((n) => ({ value: n.id, label: `${n.id} — ${titleOf(n)}` })),
        // Kept as every notice rather than only those with bids: a reader may
        // legitimately want to confirm that a tender has no bids.
      },
      {
        key: 'deadline',
        label: 'Notice deadline',
        hint: `The deadline of the notice this bid answers, compared with ${today}. A bid has no deadline of its own.`,
        category: 'Tender & Entity',
        options: DEADLINE_FILTER_OPTIONS,
      },
    ],
    // Recomputed only when the underlying records change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [today],
  )

  return (
    <RecordListPage
      title="Bids"
      description="Our pursuit of each procurement notice: whether we may bid, whether we chose to, and where the bid stands. A bid is our own response to a buyer's notice, not the notice itself and not a contract. The three status columns are independent and are expected to disagree: there is no combined verdict and no single bid status, and no win rate or attractiveness score is shown, because four records from one invented buyer cannot support one."
      records={bids}
      searchPlaceholder="Search ID, company, notice, lot…"
      filters={filters}
      urlFilters={['eligibility', 'decision', 'status', 'companyId', 'noticeId', 'deadline']}
      sorts={[
        { key: 'deadline', label: 'Notice deadline (earliest, blanks last)' },
        { key: 'status', label: 'Bid status (lifecycle order)' },
        { key: 'decision', label: 'Decision (grouped)' },
        { key: 'eligibility', label: 'Eligibility (grouped)' },
        { key: 'id', label: 'ID' },
      ]}
      initialSort="deadline"
      filterRecords={(records, active) => {
        // A linked notice or company acts as one more restriction, layered under
        // whatever the reader has set in the controls. A record has to satisfy
        // all of them.
        let merged = { ...active }
        if (presetNotice) merged = { ...merged, noticeId: presetNotice }
        if (presetCompany) merged = { ...merged, companyId: presetCompany }
        const keep = new Set(filterBids(merged, today).map((b) => b.id))
        return records.filter((r) => keep.has(r.id))
      }}
      sortRecords={(records, sortKey) =>
        sortBids(
          records,
          sortKey === 'status'
            ? 'status'
            : sortKey === 'decision'
              ? 'decision'
              : sortKey === 'eligibility'
                ? 'eligibility'
                : sortKey === 'id'
                  ? 'id'
                  : 'deadline',
        )
      }
      filterExtra={
        presetNotice || presetCompany ? (
          <p className="filterbar__note">
            Showing bids for{' '}
            {presetNotice ? <strong>{presetNotice}</strong> : null}
            {presetNotice && presetCompany ? ' and ' : null}
            {presetCompany ? <strong>{presetCompany}</strong> : null}
            , chosen from another page.{' '}
            <button
              type="button"
              className="btn btn--clear"
              onClick={() => {
                params.delete('notice')
                params.delete('company')
                setParams(params, { replace: true })
              }}
            >
              Show all bids
            </button>
          </p>
        ) : null
      }
      columns={[
        {
          key: 'id',
          header: 'Bid',
          render: (r) => (
            <span className="recordlink">
              <IdBadge id={r.id} />
              <Link to={pathForRecord(r.id) ?? '#'} className="recordlink__name">
                {titleOf(r)}
              </Link>
            </span>
          ),
          // A Bid has no name field, so its ID is the label. The two things
          // someone actually searches a bid list for are the company and the
          // tender it answers, so both are searchable alongside the ID.
          search: (r) => {
            const company = companyForBid(r.id)
            const notice = noticeForBid(r.id)
            return `${r.id} ${company?.id ?? ''} ${company ? titleOf(company) : ''} ${
              notice?.id ?? ''
            } ${notice ? titleOf(notice) : ''} ${String(field(r, 'lot_numbers') ?? '')}`
          },
        },
        {
          key: 'notice',
          header: 'Notice',
          render: (r) => {
            const notice = noticeForBid(r.id)
            return notice ? (
              <Link to={pathForRecord(notice.id) ?? '#'}>{notice.id}</Link>
            ) : (
              <span className="value value--absent">not recorded</span>
            )
          },
        },
        {
          key: 'company',
          header: 'Company',
          render: (r) => {
            const company = companyForBid(r.id)
            return company ? (
              <Link to={pathForRecord(company.id) ?? '#'}>{company.id}</Link>
            ) : (
              <span className="value value--absent">not recorded</span>
            )
          },
        },
        // A bid's Contracts resolve either to real records or to the honest
        // "none": a bid that never reached award has produced nothing, and that
        // zero is a fact about the bid, not a missing column.
        {
          key: 'contracts',
          header: 'Contracts',
          render: (r) => <RelatedLinks ids={contractsForBid(r.id).map((c) => c.id)} />,
          search: (r) => contractsForBid(r.id).map((c) => c.id).join(' '),
        },
        // Axis 1. Reused vocabulary from Match, deliberately unchanged.
        {
          key: 'eligibility_status',
          header: 'Eligibility',
          render: (r) => <StatusCell value={field(r, 'eligibility_status')} />,
          search: (r) => String(field(r, 'eligibility_status') ?? ''),
        },
        // Axis 2. The go/no-go decision, which is NOT the lifecycle status.
        {
          key: 'bid_decision',
          header: 'Decision',
          render: (r) => <StatusCell value={field(r, 'bid_decision')} />,
          search: (r) => String(field(r, 'bid_decision') ?? ''),
        },
        // Axis 3.
        {
          key: 'bid_status',
          header: 'Bid status',
          render: (r) => <StatusCell value={field(r, 'bid_status')} />,
          search: (r) => String(field(r, 'bid_status') ?? ''),
        },
        // The Bid record has no deadline of its own, so this column states whose
        // deadline it is rather than implying the bid carries one.
        {
          key: 'deadline',
          header: 'Notice deadline',
          render: (r) => {
            const notice = noticeForBid(r.id)
            if (!notice) return <span className="value value--absent">no notice</span>
            return <DeadlineBadge date={field(notice, 'bid_submission_deadline')} today={today} />
          },
          search: (r) => {
            const notice = noticeForBid(r.id)
            return notice ? String(field(notice, 'bid_submission_deadline') ?? '') : ''
          },
        },
      ]}
    />
  )
}