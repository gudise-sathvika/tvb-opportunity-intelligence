import RecordDetailPage from '../components/records/RecordDetail'
import { applicationForMatch, companyForMatch, opportunityForMatch } from '../data/selectors'
import type { RecordRow } from '../types/records'
import type { RelatedGroup } from '../components/records/RecordDetail'

/** A single-record group, with an explicit note when nothing is recorded. */
function single(label: string, rec: RecordRow | undefined, emptyNote: string): RelatedGroup {
  return { label, records: rec ? [rec] : [], emptyNote }
}

const groups = (rec: RecordRow): RelatedGroup[] => [
  single('Company', companyForMatch(rec.id), 'No company recorded'),
  single('Opportunity', opportunityForMatch(rec.id), 'No opportunity recorded'),
  single(
    'Application (optional)',
    applicationForMatch(rec.id),
    'No application recorded for this match',
  ),
]

export default function MatchDetail() {
  return <RecordDetailPage recordType="match" related={groups} />
}
