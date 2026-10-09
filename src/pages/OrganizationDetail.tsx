import RecordDetailPage from '../components/records/RecordDetail'
import { noticesForOrganization, opportunitiesForOrganization } from '../data/selectors'
import type { RecordRow } from '../types/records'
import type { RelatedGroup } from '../components/records/RecordDetail'

const groups = (rec: RecordRow): RelatedGroup[] => [
  {
    label: 'Opportunities provided',
    records: opportunitiesForOrganization(rec.id),
    emptyNote:
      'No opportunities record this organization as their provider. The relationship is derived from Opportunity.provider.',
  },
  {
    label: 'Notices issued',
    records: noticesForOrganization(rec.id),
    emptyNote:
      'No notices name this organization as the buyer. The relationship is derived from Notice.procuring_entity.',
  },
]

export default function OrganizationDetail() {
  return <RecordDetailPage recordType="organization" related={groups} />
}
