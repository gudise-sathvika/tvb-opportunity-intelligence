import RecordDetailPage from '../components/records/RecordDetail'
import { DocumentSection } from '../components/records/DocumentSection'
import {
  bidsForNotice,
  contractsForNotice,
  procuringEntityForNotice,
  sourcesForNotice,
} from '../data/selectors'
import type { RecordRow } from '../types/records'
import type { RelatedGroup } from '../components/records/RecordDetail'

/**
 * Notice detail.
 *
 * Every field renders in template order from the shared detail component, so
 * this file only describes RELATIONSHIPS.
 *
 * The relationship groups below are the complete set for Notice: Organization
 * (the buyer), Source (the evidence), Bid (our response), and Contract (what the
 * award became). Notice is 1:N Contract — one solicitation can produce several
 * instruments, whether as separate lots or repeated call-offs under a framework —
 * so the Contract group is a list even for a single-lot notice. There is
 * deliberately no Opportunity group and no Match group — Phase 1 rules Match out
 * of procurement entirely and decision D12 keeps the funding and procurement
 * domains apart. The absence is stated on the page rather than left unsaid,
 * because a reader who expects a funding link deserves to be told there is none.
 */
const groups = (rec: RecordRow): RelatedGroup[] => {
  const buyer = procuringEntityForNotice(rec.id)
  return [
    {
      label: 'Procuring entity (buyer)',
      records: buyer ? [buyer] : [],
      emptyNote:
        'No procuring_entity recorded. Every Notice names its buyer; the relationship comes from Notice.procuring_entity.',
    },
    {
      label: 'Linked sources',
      records: sourcesForNotice(rec.id),
      emptyNote:
        'No linked_sources recorded. Corrigenda and clarifications are Source records appended to Notice.linked_sources.',
    },
    {
      label: 'Bids against this notice',
      records: bidsForNotice(rec.id),
      emptyNote:
        'No Bid recorded against this notice. A Notice is 1:N Bid — one tender attracts many bids, which is the defining divergence from the funding types — so this is genuinely "not yet pursued", not "exactly one exists".',
    },
    {
      label: 'Contracts generated',
      records: contractsForNotice(rec.id),
      emptyNote:
        'No contracts generated yet. A Contract is required to name its Notice, so every contract in the vault is reachable from here — including single-source awards, which still descend from a published notice.',
    },
    {
      label: 'Funding opportunity link',
      records: [],
      emptyNote:
        'None, by design. Phase 1 decision D12 keeps procurement and funding separate, so a Notice is never an Opportunity.',
    },
  ]
}

export default function NoticeDetail() {
  return (
    <RecordDetailPage
      recordType="notice"
      related={groups}
      above={(rec) => <DocumentSection rec={rec} />}
    />
  )
}