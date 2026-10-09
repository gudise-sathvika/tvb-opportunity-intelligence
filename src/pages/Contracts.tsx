import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import RecordListPage, { StatusCell } from '../components/tables/RecordTable'
import { IdBadge } from '../components/ui/Badges'
import type { FilterDef } from '../components/tables/FilterBar'
import { contractCurrencies, filterContracts, sortContracts } from '../data/procurement'
import {
  bidForContract,
  companiesWithContracts,
  companyForContract,
  field,
  listBids,
  listContracts,
  listNotices,
  noticeForContract,
  pathForRecord,
  titleOf,
} from '../data/selectors'

/**
 * Contracts — the post-award side of procurement.
 *
 * A Notice is what a buyer published, a Bid is what we did about it, and a
 * Contract is what we are obliged to deliver once we have won. This list starts
 * where the other two end, which is why it has no award-date column: that date
 * lives on the Bid, deliberately, and repeating it here would create two fields
 * that can disagree.
 *
 * Four status columns are shown side by side and none of them is combined into a
 * single verdict. `Delivered` + `Under inspection` + `Partially paid` is an
 * ordinary state on `CON-002` — the work is finished, the buyer has not signed it
 * off, and half the money is in. Collapsing those three words into one status
 * would force the record to misrepresent one of them.
 *
 * There is deliberately NO total-value column and no portfolio figure. `CON-005`
 * is denominated in USD and everything else in INR; a single sum across the two
 * would be a confident-looking number meaning nothing. Currency is offered as a
 * filter so a reader can restrict to one before looking at amounts, never as a
 * grouping that adds them together.
 */
export default function Contracts() {
  const contracts = listContracts()

  // The Notice, Bid, and Company pages link here with ?notice=, ?bid=, or
  // ?company= so a reader who asked "what contracts came from this tender?" lands
  // already filtered. Read here rather than redirecting, so the result stays
  // visible on the page and clearable in place.
  const [params, setParams] = useSearchParams()
  const presetNotice = params.get('notice') ?? ''
  const presetBid = params.get('bid') ?? ''
  const presetCompany = params.get('company') ?? ''

  const statusOptions = (fieldName: string) => {
    const counts = new Map<string, number>()
    for (const c of contracts) {
      const v = field(c, fieldName)
      if (typeof v === 'string' && v !== '') counts.set(v, (counts.get(v) ?? 0) + 1)
    }
    return [...counts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([value, count]) => ({ value, label: value, count }))
  }

  const filters: FilterDef[] = useMemo(
    () => [
      {
        key: 'status',
        label: 'Contract status',
        hint: 'Phase 1 section 8.6 lifecycle: Awarded, Active, Delivered, Accepted, Completed, with Under dispute and Terminated reachable from Active. Independent of the three columns below.',
        primary: true,
        options: statusOptions('contract_status'),
      },
      {
        key: 'acceptance',
        label: 'Acceptance',
        hint: 'Whether the buyer has accepted what was delivered. `Not applicable` means no acceptance process is running, which is different from `Pending`.',
        primary: true,
        options: statusOptions('acceptance_status'),
      },
      {
        key: 'payment',
        label: 'Payment',
        hint: 'Whether money has moved. Terms commonly pay against milestones rather than acceptance, so `Partially paid` alongside `Pending` acceptance is normal.',
        primary: true,
        options: statusOptions('payment_status'),
      },
      {
        key: 'security',
        label: 'Performance security',
        hint: "What the buyer has done with the security WE posted. This is our security, not the buyer's demand for it.",
        primary: true,
        options: statusOptions('performance_security_status'),
      },
      {
        key: 'bidPresence',
        label: 'Bid behind it',
        hint: 'Single-source and negotiated awards have no competing bid, so `contract_basis` records why. Both directions are offered: a contract with no bid is a category to inspect, not a defect.',
        category: 'Parties & Tender',
        options: [
          { value: 'with_bid', label: 'Has a linked bid (competitive)' },
          { value: 'without_bid', label: 'No bid (non-competitive)' },
        ],
      },
      {
        key: 'companyId',
        label: 'Company',
        hint: 'The awarded counterparty.',
        category: 'Parties & Tender',
        options: companiesWithContracts().map((c) => ({ value: c.id, label: `${c.id} — ${titleOf(c)}` })),
      },
      {
        key: 'noticeId',
        label: 'Notice',
        hint: 'The procurement this arose from. Required on every contract, including non-competitive ones.',
        category: 'Parties & Tender',
        options: listNotices().map((n) => ({ value: n.id, label: `${n.id} — ${titleOf(n)}` })),
      },
      {
        key: 'bidId',
        label: 'Winning bid',
        hint: 'The bid this contract came from. One bid can produce several contracts where an award covers more than one lot.',
        category: 'Parties & Tender',
        options: listBids().map((b) => ({ value: b.id, label: `${b.id} — ${titleOf(b)}` })),
      },
      {
        key: 'currency',
        label: 'Currency',
        hint: 'Restricts to one currency before any amount is read. Amounts here are never summed across currencies.',
        category: 'Parties & Tender',
        options: contractCurrencies(contracts).map((c) => ({ value: c, label: c })),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  return (
    <RecordListPage
      title="Contracts"
      description="What we are obliged to deliver once we have won: the buyer's reference, the value in its own currency, the term, and where delivery, acceptance, and payment each stand. The four status columns are independent and are expected to disagree. The award date is not here — it stays on the Bid, which owns the competitive outcome. No total value is shown or offered, because these records are denominated in more than one currency and adding across currencies would produce a meaningless number."
      records={contracts}
      searchPlaceholder="Search reference, title, company, notice, lot…"
      filters={filters}
      urlFilters={['status', 'acceptance', 'payment', 'security', 'bidPresence', 'companyId', 'noticeId', 'bidId', 'currency']}
      sorts={[
        { key: 'status', label: 'Contract status (lifecycle order)' },
        { key: 'end', label: 'Contract end date (earliest, blanks last)' },
        { key: 'value', label: 'Contract value (raw amount, not converted)' },
        { key: 'id', label: 'ID' },
      ]}
      initialSort="status"
      filterRecords={(records, active) => {
        // A preset notice, bid, or company acts as one more restriction layered
        // under the controls. A record must satisfy all of them.
        let merged = { ...active } as Parameters<typeof filterContracts>[0]
        if (presetNotice) merged = { ...merged, noticeId: presetNotice }
        if (presetBid) merged = { ...merged, bidId: presetBid }
        if (presetCompany) merged = { ...merged, companyId: presetCompany }
        const keep = new Set(filterContracts(merged).map((c) => c.id))
        return records.filter((r) => keep.has(r.id))
      }}
      sortRecords={(records, sortKey) =>
        sortContracts(
          records,
          sortKey === 'end' ? 'end' : sortKey === 'value' ? 'value' : sortKey === 'id' ? 'id' : 'status',
        )
      }
      filterExtra={
        presetNotice || presetBid || presetCompany ? (
          <p className="filterbar__note">
            Showing contracts for{' '}
            {presetNotice ? <strong>{presetNotice}</strong> : null}
            {presetNotice && (presetBid || presetCompany) ? ', ' : null}
            {presetBid ? <strong>{presetBid}</strong> : null}
            {presetBid && presetCompany ? ' and ' : null}
            {presetCompany ? <strong>{presetCompany}</strong> : null}
            , chosen from another page.{' '}
            <button
              type="button"
              className="btn btn--clear"
              onClick={() => {
                params.delete('notice')
                params.delete('bid')
                params.delete('company')
                setParams(params, { replace: true })
              }}
            >
              Show all contracts
            </button>
          </p>
        ) : null
      }
      columns={[
        {
          key: 'id',
          header: 'Contract',
          render: (r) => (
            <span className="recordlink">
              <IdBadge id={r.id} />
              <Link to={pathForRecord(r.id) ?? '#'} className="recordlink__name">
                {titleOf(r)}
              </Link>
            </span>
          ),
          // `contract_number` is the display title because it is required while
          // `contract_title` is optional. The title text and the lot are the other
          // things a reader searches a contract list for.
          search: (r) =>
            `${r.id} ${String(field(r, 'contract_title') ?? '')} ${String(
              field(r, 'lot_number') ?? '',
            )} ${noticeForContract(r.id)?.id ?? ''} ${companyForContract(r.id)?.id ?? ''}`,
        },
        {
          key: 'notice',
          header: 'Notice',
          render: (r) => {
            const notice = noticeForContract(r.id)
            return notice ? (
              <Link to={pathForRecord(notice.id) ?? '#'}>{notice.id}</Link>
            ) : (
              <span className="value value--absent">not recorded</span>
            )
          },
        },
        {
          key: 'bid',
          header: 'From bid',
          render: (r) => {
            const bid = bidForContract(r.id)
            // A blank here is a recorded fact, not missing data, so it is
            // labelled rather than shown as an empty cell. `contract_basis` on
            // the record says why.
            if (!bid) {
              const basis = field(r, 'contract_basis')
              return (
                <span className="value value--absent">
                  no bid{basis ? ` — ${String(basis)}` : ''}
                </span>
              )
            }
            return <Link to={pathForRecord(bid.id) ?? '#'}>{bid.id}</Link>
          },
          search: (r) => {
            const bid = bidForContract(r.id)
            return bid ? bid.id : String(field(r, 'contract_basis') ?? '')
          },
        },
        {
          key: 'lot',
          header: 'Lot',
          render: (r) => {
            const lot = field(r, 'lot_number')
            return lot ? (
              String(lot)
            ) : (
              <span className="value value--absent">not applicable</span>
            )
          },
        },
        {
          key: 'company',
          header: 'Company',
          render: (r) => {
            const company = companyForContract(r.id)
            return company ? (
              <Link to={pathForRecord(company.id) ?? '#'}>{company.id}</Link>
            ) : (
              <span className="value value--absent">not recorded</span>
            )
          },
        },
        {
          key: 'value',
          header: 'Value',
          // Rendered with its currency on every row, never bare. The currency is
          // part of the value, not metadata about it.
          render: (r) => {
            const v = field(r, 'contract_value')
            const cur = field(r, 'contract_value_currency')
            if (v === '' || v === undefined) {
              return <span className="value value--absent">not recorded</span>
            }
            return (
              <span className="money">
                {String(v)} <span className="money__currency">{String(cur ?? '')}</span>
              </span>
            )
          },
          search: (r) =>
            `${String(field(r, 'contract_value') ?? '')} ${String(
              field(r, 'contract_value_currency') ?? '',
            )}`,
        },
        // The four independent axes.
        {
          key: 'contract_status',
          header: 'Contract status',
          render: (r) => <StatusCell value={field(r, 'contract_status')} />,
          search: (r) => String(field(r, 'contract_status') ?? ''),
        },
        {
          key: 'acceptance_status',
          header: 'Acceptance',
          render: (r) => <StatusCell value={field(r, 'acceptance_status')} />,
          search: (r) => String(field(r, 'acceptance_status') ?? ''),
        },
        {
          key: 'payment_status',
          header: 'Payment',
          render: (r) => <StatusCell value={field(r, 'payment_status')} />,
          search: (r) => String(field(r, 'payment_status') ?? ''),
        },
        {
          key: 'performance_security_status',
          header: 'Perf. security',
          render: (r) => <StatusCell value={field(r, 'performance_security_status')} />,
          search: (r) => String(field(r, 'performance_security_status') ?? ''),
        },
      ]}
    />
  )
}