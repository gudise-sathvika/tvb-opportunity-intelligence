import RecordDetailPage from '../components/records/RecordDetail'
import { companyForApplication, matchForApplication, opportunityForApplication } from '../data/selectors'
import type { RecordRow } from '../types/records'
import type { RelatedGroup } from '../components/records/RecordDetail'

function single(label: string, rec: RecordRow | undefined, emptyNote: string): RelatedGroup {
  return { label, records: rec ? [rec] : [], emptyNote }
}

const groups = (rec: RecordRow): RelatedGroup[] => [
  single('Company', companyForApplication(rec.id), 'No company recorded'),
  single('Opportunity', opportunityForApplication(rec.id), 'No opportunity recorded'),
  single('Match (optional)', matchForApplication(rec.id), 'No originating match recorded'),
]

export default function ApplicationDetail() {
  return <RecordDetailPage recordType="application" related={groups} />
}
