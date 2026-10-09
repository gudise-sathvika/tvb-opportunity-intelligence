import RecordDetailPage from '../components/records/RecordDetail'
import {
  applicationsForOpportunity,
  matchesForOpportunity,
  providerFor,
  sourcesForOpportunity,
} from '../data/selectors'
import type { RecordRow } from '../types/records'
import type { RelatedGroup } from '../components/records/RecordDetail'

const groups = (rec: RecordRow): RelatedGroup[] => {
  const provider = providerFor(rec.id)
  return [
    {
      label: 'Provider organization',
      records: provider ? [provider] : [],
      emptyNote: 'No provider recorded',
    },
    { label: 'Sources', records: sourcesForOpportunity(rec.id), emptyNote: 'No sources recorded' },
    { label: 'Matches', records: matchesForOpportunity(rec.id), emptyNote: 'No matches recorded' },
    {
      label: 'Applications',
      records: applicationsForOpportunity(rec.id),
      emptyNote: 'No applications recorded',
    },
  ]
}

export default function OpportunityDetail() {
  return <RecordDetailPage recordType="opportunity" related={groups} />
}
