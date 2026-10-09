import RecordDetailPage from '../components/records/RecordDetail'
import { bidsForSource, noticesForSource, opportunityForSource } from '../data/selectors'
import type { RecordRow } from '../types/records'
import type { RelatedGroup } from '../components/records/RecordDetail'

/**
 * Source detail.
 *
 * A Source is evidence, and Phase 1 section 7.3 is explicit that a procurement
 * claim's evidence is a Source record rather than a new field on the claim. Two
 * different claims can therefore cite the same Source: a Notice (the evidence
 * for the solicitation) and a Bid (the evidence for an eligibility conclusion).
 * They are separate groups, because they are separate claims.
 */
const groups = (rec: RecordRow): RelatedGroup[] => {
  const opp = opportunityForSource(rec.id)
  return [
    {
      label: 'Related opportunity',
      records: opp ? [opp] : [],
      emptyNote:
        'No opportunity recorded. The relationship comes from Source.related_opportunity, never from matching source_url.',
    },
    {
      label: 'Notices evidenced',
      records: noticesForSource(rec.id),
      emptyNote:
        'No notice cites this source. The relationship comes from Notice.linked_sources. Every notice in the vault currently has an empty list, which is a recorded gap.',
    },
    {
      label: 'Bids citing this as eligibility evidence',
      records: bidsForSource(rec.id),
      emptyNote:
        'No Bid cites this source. The relationship comes from Bid.evidence_sources, and Phase 1 gate 5 requires it to be non-empty before a Bid may claim Eligible—verified.',
    },
  ]
}

export default function SourceDetail() {
  return <RecordDetailPage recordType="source" related={groups} />
}
