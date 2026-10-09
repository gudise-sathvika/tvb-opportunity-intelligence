import RecordDetailPage from '../components/records/RecordDetail'
import { DocumentSection } from '../components/records/DocumentSection'
import {
  bidForContract,
  companyForContract,
  noticeForContract,
  textField,
} from '../data/selectors'
import type { RecordRow } from '../types/records'
import type { RelatedGroup } from '../components/records/RecordDetail'

/**
 * Contract detail.
 *
 * Every field renders in template order from the shared detail component, so this
 * file only describes RELATIONSHIPS.
 *
 * The three groups below are the complete Phase 1 set for Contract: the Notice it
 * arose from, the Bid it came from, and the Company it was awarded to. The Bid
 * group is the one with a genuine optional case — a single-source or negotiated
 * award has no competing bid — so its empty note explains `contract_basis` rather
 * than reporting a missing relationship. The importer enforces that a Contract has
 * a bid or a basis, so "no bid" on this page always has a recorded reason.
 *
 * There is deliberately no Source group. Phase 1 section 6 does not give Contract
 * a `linked_sources` field, and unlike eligibility evidence on a Bid, no Contract
 * claim is gated on a source reference. Adding one would be inventing a field the
 * approved design does not have, so the absence is stated on the page.
 */
const groups = (rec: RecordRow): RelatedGroup[] => {
  const notice = noticeForContract(rec.id)
  const bid = bidForContract(rec.id)
  const company = companyForContract(rec.id)
  // Read through the selector layer, which is the single place field narrowing
  // happens for the UI. A ContractRow's frontmatter is deliberately untyped.
  const basisText = textField(rec, 'contract_basis') ?? null

  return [
    {
      label: 'Arising from notice',
      records: notice ? [notice] : [],
      emptyNote:
        'No notice recorded. Every Contract names exactly one Notice, even a single-source award, which still descends from a published procurement.',
    },
    {
      label: 'From bid',
      records: bid ? [bid] : [],
      // The optional-link case, stated positively. An absent bid is a recorded
      // fact about a non-competitive award, not an incomplete record.
      emptyNote: basisText
        ? `No bid — this was awarded on the basis "${basisText}". Phase 1 invariant 3 requires contract_basis whenever bid is blank, and the importer enforces it.`
        : 'No bid recorded. Phase 1 invariant 3 requires contract_basis to be non-blank whenever bid is blank, so this state should be impossible in imported data.',
    },
    {
      label: 'Awarded to',
      records: company ? [company] : [],
      emptyNote:
        'No company recorded. Every Contract names exactly one Company, the awarded counterparty.',
    },
    {
      label: 'Evidence sources',
      records: [],
      emptyNote:
        'None, by design. Phase 1 section 6 gives Contract no linked_sources field, and no Contract claim is gated on a source reference the way a Bid\'s Eligible—verified assessment is.',
    },
    {
      label: 'Funding application link',
      records: [],
      emptyNote:
        'None, by design. Phase 1 decision D12 keeps procurement and funding separate, so a Contract is never linked to an Opportunity, Match, or Application.',
    },
  ]
}

export default function ContractDetail() {
  return (
    <RecordDetailPage
      recordType="contract"
      related={groups}
      above={(rec) => <DocumentSection rec={rec} />}
    />
  )
}