/**
 * Funding-side filters.
 *
 * The procurement half of the app has had filters since Phase 3; the six funding
 * types did not, which meant a chart could show "2 Grants" but a reader had no way
 * to act on it. These functions give those six types the same capability.
 *
 * They follow the conventions already established in `procurement.ts`:
 *
 * - Conditions combine with AND.
 * - A filter that matches nothing returns an empty list rather than falling back
 *   to everything, so a zero-result filter reads as a zero rather than silently
 *   being ignored.
 * - `undefined` means "no restriction". An empty string is never a filter value.
 * - The special value `BLANK` selects records whose field is *not* recorded, which
 *   is a real question a reader can ask of this corpus — every Opportunity, for
 *   instance, has a blank `application_deadline`.
 */

import { BLANK, isBlankValue } from './blank'
import {
  applicationsForCompany,
  applicationsForOpportunity,
  field,
  listApplications,
  listCompanies,
  listMatches,
  listOpportunities,
  listOrganizations,
  listSources,
  matchesForCompany,
  matchesForOpportunity,
  sourcesForOpportunity,
} from './selectors'
import type { RecordRow } from '../types/records'

/** True when `rec`'s field equals `wanted`, honouring the `BLANK` special value. */
function matches(rec: RecordRow, name: string, wanted: string | undefined): boolean {
  if (!wanted) return true
  if (wanted === BLANK) return isBlankValue(field(rec, name))
  return field(rec, name) === wanted
}

/**
 * Resolve a related collection to a set of ids once per filter run.
 *
 * The relationship selectors return arrays, so testing membership with `.some` per
 * record would rescan them for every record. One set per run keeps each filter
 * linear in the number of records, which matters once a dashboard can link to any
 * of these filters.
 */
function idSet(recs: RecordRow[]): Set<string> {
  return new Set(recs.map((r) => r.id))
}

/* ------------------------------------------------------------------ */
/* Opportunity                                                          */
/* ------------------------------------------------------------------ */

export interface OpportunityFilter {
  opportunityType?: string
  verificationStatus?: string
  recordStatus?: string
  country?: string
  /** The `provider` link, by organisation id. */
  providerId?: string
  /** True keeps only Opportunities with a recorded `application_deadline`. */
  hasDeadline?: boolean
}

export function filterOpportunities(f: OpportunityFilter): RecordRow[] {
  return listOpportunities().filter((o) => {
    if (!matches(o, 'opportunity_type', f.opportunityType)) return false
    if (!matches(o, 'verification_status', f.verificationStatus)) return false
    if (!matches(o, 'record_status', f.recordStatus)) return false
    if (!matches(o, 'country', f.country)) return false
    if (f.providerId && !(o.links.fields.provider ?? []).some((l) => l.resolvedId === f.providerId)) return false
    if (f.hasDeadline !== undefined) {
      const recorded = !isBlankValue(field(o, 'application_deadline'))
      if (recorded !== f.hasDeadline) return false
    }
    return true
  })
}

/* ------------------------------------------------------------------ */
/* Match                                                                */
/* ------------------------------------------------------------------ */

export interface MatchFilter {
  matchStatus?: string
  eligibilityStatus?: string
  priority?: string
  companyId?: string
  opportunityId?: string
  /** True keeps only Matches that link to an Application. */
  hasApplication?: boolean
}

export function filterMatches(f: MatchFilter): RecordRow[] {
  const companyIds = f.companyId ? idSet(matchesForCompany(f.companyId)) : null
  const opportunityIds = f.opportunityId ? idSet(matchesForOpportunity(f.opportunityId)) : null
  return listMatches().filter((m) => {
    if (!matches(m, 'match_status', f.matchStatus)) return false
    if (!matches(m, 'eligibility_status', f.eligibilityStatus)) return false
    if (!matches(m, 'priority', f.priority)) return false
    if (companyIds && !companyIds.has(m.id)) return false
    if (opportunityIds && !opportunityIds.has(m.id)) return false
    if (f.hasApplication !== undefined) {
      const linked = (m.links.fields.linked_application ?? []).length > 0
      if (linked !== f.hasApplication) return false
    }
    return true
  })
}

/* ------------------------------------------------------------------ */
/* Application                                                          */
/* ------------------------------------------------------------------ */

export interface ApplicationFilter {
  applicationStatus?: string
  companyId?: string
  opportunityId?: string
  /** True keeps only Applications whose `submission_date` is recorded. */
  hasSubmissionDate?: boolean
}

export function filterApplications(f: ApplicationFilter): RecordRow[] {
  const companyIds = f.companyId ? idSet(applicationsForCompany(f.companyId)) : null
  const opportunityIds = f.opportunityId ? idSet(applicationsForOpportunity(f.opportunityId)) : null
  return listApplications().filter((a) => {
    if (!matches(a, 'application_status', f.applicationStatus)) return false
    if (companyIds && !companyIds.has(a.id)) return false
    if (opportunityIds && !opportunityIds.has(a.id)) return false
    if (f.hasSubmissionDate !== undefined) {
      const recorded = !isBlankValue(field(a, 'submission_date'))
      if (recorded !== f.hasSubmissionDate) return false
    }
    return true
  })
}

/* ------------------------------------------------------------------ */
/* Company                                                              */
/* ------------------------------------------------------------------ */

export interface CompanyFilter {
  profileStatus?: string
  country?: string
  /** True keeps only Companies with at least one linked Match. */
  hasMatches?: boolean
}

export function filterCompanies(f: CompanyFilter): RecordRow[] {
  return listCompanies().filter((c) => {
    if (!matches(c, 'profile_status', f.profileStatus)) return false
    if (!matches(c, 'country', f.country)) return false
    if (f.hasMatches !== undefined) {
      const linked = matchesForCompany(c.id).length > 0
      if (linked !== f.hasMatches) return false
    }
    return true
  })
}

/* ------------------------------------------------------------------ */
/* Organization                                                         */
/* ------------------------------------------------------------------ */

export interface OrganizationFilter {
  organizationType?: string
  country?: string
  /** True keeps only Organizations that publish or issue at least one record. */
  hasRecords?: boolean
}

export function filterOrganizations(f: OrganizationFilter): RecordRow[] {
  return listOrganizations().filter((o) => {
    if (!matches(o, 'organization_type', f.organizationType)) return false
    if (!matches(o, 'country', f.country)) return false
    if (f.hasRecords !== undefined) {
      const linked =
        (o.links.fields.opportunities ?? []).length > 0 || (o.links.fields.notices ?? []).length > 0
      if (linked !== f.hasRecords) return false
    }
    return true
  })
}

/* ------------------------------------------------------------------ */
/* Source                                                               */
/* ------------------------------------------------------------------ */

export interface SourceFilter {
  sourceType?: string
  opportunityId?: string
  /** True keeps only Sources whose `last_checked` is recorded. */
  hasLastChecked?: boolean
}

export function filterSources(f: SourceFilter): RecordRow[] {
  const opportunityIds = f.opportunityId ? idSet(sourcesForOpportunity(f.opportunityId)) : null
  return listSources().filter((s) => {
    if (!matches(s, 'source_type', f.sourceType)) return false
    if (opportunityIds && !opportunityIds.has(s.id)) return false
    if (f.hasLastChecked !== undefined) {
      const recorded = !isBlankValue(field(s, 'last_checked'))
      if (recorded !== f.hasLastChecked) return false
    }
    return true
  })
}

/* ------------------------------------------------------------------ */
/* Source freshness, as counts                                          */
/* ------------------------------------------------------------------ */

/**
 * How many Sources record a `last_checked` date.
 *
 * Reported as "n of m" rather than a percentage or an age, because the snapshot
 * records no staleness threshold and inventing one would produce a freshness score
 * the data cannot support.
 */
export function sourceFreshness(): { total: number; checked: number; unchecked: number } {
  const sources = listSources()
  const checked = sources.filter((s) => !isBlankValue(field(s, 'last_checked'))).length
  return { total: sources.length, checked, unchecked: sources.length - checked }
}

export { BLANK }
