import RecordDetailPage from '../components/records/RecordDetail'
import { DocumentSection } from '../components/records/DocumentSection'
import {
  companyForBid,
  contractsForBid,
  noticeForBid,
  sourcesForBid,
} from '../data/selectors'
import type { RecordRow } from '../types/records'
import type { RelatedGroup } from '../components/records/RecordDetail'

/**
 * Bid detail.
 *
 * Every field renders in template order from the shared detail component, so
 * this file only describes RELATIONSHIPS.
 *
 * The three groups below are the complete Phase 1 set for Bid: the Company that
 * submitted it, the Notice it pursues, and the Sources evidencing the eligibility
 * assessment. There is deliberately no Opportunity group and no Match group —
 * Phase 1 section 7.2 rules Match out of procurement and decision D12 keeps the
 * funding and procurement domains apart. The absence is stated on the page
 * rather than left unsaid.
 *
 * The Contract group arrived in Phase 6 and is a LIST, not a single record.
 * Phase 1 section 7.1 corrected `Bid -> Contract` from 0..1 to 1:0..N because one
 * award can produce a contract per awarded lot, or a framework with several
 * orders. `BID-005` is the demonstration case: one award across two lots produces
 * two contracts. A single-record group would have had to drop one.
 *
 * The award facts (`award_date`, `awarded_value`) stay on this Bid, and this page
 * never shows a contract's award date, because Contract does not have one.
 */
const groups = (rec: RecordRow): RelatedGroup[] => {
  const company = companyForBid(rec.id)
  const notice = noticeForBid(rec.id)
  return [
    {
      label: 'Notice pursued',
      records: notice ? [notice] : [],
      emptyNote:
        'No notice recorded. Every Bid names exactly one Notice; the relationship comes from Bid.notice.',
    },
    {
      label: 'Bidding company',
      records: company ? [company] : [],
      emptyNote:
        'No company recorded. Every Bid names exactly one Company, the lead bidder. Consortiums are deferred by Phase 1 decision D6, so this is never a list.',
    },
    {
      label: 'Eligibility evidence sources',
      records: sourcesForBid(rec.id),
      emptyNote:
        'No evidence_sources recorded. Phase 1 gate 5 requires this to be non-empty before eligibility_status can be Eligible—verified.',
    },
    {
      label: 'Funding opportunity link',
      records: [],
      emptyNote:
        'None, by design. Phase 1 decision D12 keeps procurement and funding separate, so a Bid is never linked to an Opportunity.',
    },
    {
      // 1:0..N, so a list. One award covering several lots yields one contract
      // per lot, all pointing back here.
      label: 'Contracts produced',
      records: contractsForBid(rec.id),
      emptyNote:
        'No contracts yet. An awarded bid produces contracts as instruments are signed, and a bid that lost or has not yet been awarded produces none. Where award_date is recorded, it stays on this page and is never repeated on a contract.',
    },
  ]
}

export default function BidDetail() {
  return <RecordDetailPage recordType="bid" related={groups} above={(rec) => <DocumentSection rec={rec} />} />
}