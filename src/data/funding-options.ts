/**
 * Shared option builders for the funding list filters.
 *
 * The funding pages had no filter bar until this phase, so there is no precedent to
 * follow on this side; these helpers reuse `groupCounts` from the analytics layer so
 * the filter options and the dashboard charts are computed by exactly the same
 * function. That matters: if the two disagreed, clicking a chart segment could land
 * on a list showing a different count than the segment claimed.
 *
 * Options carry their counts, including zeros, matching the convention the
 * procurement filters already use. A reader can see what an option is worth before
 * choosing it, and a declared-but-empty state is visibly empty rather than absent.
 *
 * Counts are over the full collection, never the currently filtered subset, so the
 * numbers do not shift under the reader as they narrow.
 */

import { groupCounts } from '../analytics/dashboard'
import type { SeriesPoint } from '../analytics/dashboard'
import {
  listApplications,
  listCompanies,
  listMatches,
  listOpportunities,
  listOrganizations,
  listSources,
} from './selectors'
import type { RecordRow } from '../types/records'
import type { FilterDef, SelectOption } from '../components/tables/FilterBar'

/** Turn analytics points into filter options, preserving every declared value. */
export function optionsFrom(points: SeriesPoint[]): SelectOption[] {
  return points.map((p) => ({ value: p.value, label: p.label, count: p.count }))
}

/** Options for one field over one collection, zeros included. */
export function optionsFor(recs: RecordRow[], fieldName: string): SelectOption[] {
  return optionsFrom(groupCounts(recs, fieldName))
}

/**
 * A filter definition over one recorded field.
 *
 * `fieldName` is the frontmatter key; `key` is the camelCase name used by the
 * filter callback and, because the list pages sync filters to the query string, the
 * query parameter name in a drill-down URL.
 */
export function fieldFilter(
  recs: RecordRow[],
  key: string,
  label: string,
  fieldName: string,
  hint: string,
  extra?: { primary?: boolean; category?: string },
): FilterDef {
  return { key, label, hint, options: optionsFor(recs, fieldName), ...extra }
}

/** A yes/no filter for a condition, e.g. "records a provider". */
export function booleanFilter(
  key: string,
  label: string,
  hint: string,
  yes: { label: string; count: number },
  no: { label: string; count: number },
  extra?: { primary?: boolean; category?: string },
): FilterDef {
  return {
    key,
    label,
    hint,
    options: [
      { value: 'yes', label: yes.label, count: yes.count },
      { value: 'no', label: no.label, count: no.count },
    ],
    ...extra,
  }
}

/* ------------------------------------------------------------------ */
/* Per-type filter sets, built once from the live snapshot              */
/* ------------------------------------------------------------------ */

export function opportunityFilters(): FilterDef[] {
  const opportunities = listOpportunities()
  const withDeadline = opportunities.filter((o) => typeof o.frontmatter.application_deadline === 'string' && o.frontmatter.application_deadline !== '').length
  return [
    fieldFilter(opportunities, 'opportunityType', 'Grant type', 'opportunity_type', 'The funding instrument as the provider describes it.', { primary: true }),
    booleanFilter(
      'hasDeadline',
      'Application deadline',
      'Whether an application_deadline is recorded. A blank deadline is not a passed deadline.',
      { label: 'Recorded', count: withDeadline },
      { label: 'Not recorded', count: opportunities.length - withDeadline },
      { primary: true },
    ),
    fieldFilter(
      opportunities,
      'verificationStatus',
      'Verification',
      'verification_status',
      'What this vault records about its own source. Not an independent approval by anyone else.',
      { category: 'Status & Scope' },
    ),
    fieldFilter(opportunities, 'recordStatus', 'Record status', 'record_status', 'The lifecycle state recorded on the Opportunity.', { category: 'Status & Scope' }),
    fieldFilter(opportunities, 'country', 'Country', 'country', 'The country recorded on the Opportunity.', { category: 'Status & Scope' }),
  ]
}

export function matchFilters(): FilterDef[] {
  const matches = listMatches()
  const withApplication = matches.filter((m) => (m.links.fields.linked_application ?? []).length > 0).length
  return [
    fieldFilter(matches, 'matchStatus', 'Match status', 'match_status', 'Where the review of this pairing has reached.', { primary: true }),
    fieldFilter(
      matches,
      'eligibilityStatus',
      'Eligibility',
      'eligibility_status',
      'The vault author\'s eligibility assessment. This is not an approval by the platform.',
      { primary: true },
    ),
    fieldFilter(matches, 'priority', 'Priority', 'priority', 'The recorded working priority. Not a score computed here.', { category: 'Assessment & Links' }),
    booleanFilter(
      'hasApplication',
      'Application',
      'Whether this Match links to an Application.',
      { label: 'Linked', count: withApplication },
      { label: 'No application', count: matches.length - withApplication },
      { category: 'Assessment & Links' },
    ),
  ]
}

export function applicationFilters(): FilterDef[] {
  const applications = listApplications()
  const submitted = applications.filter(
    (a) => typeof a.frontmatter.submission_date === 'string' && a.frontmatter.submission_date !== '',
  ).length
  return [
    fieldFilter(
      applications,
      'applicationStatus',
      'Status',
      'application_status',
      'The status recorded on the Application.',
      { primary: true },
    ),
    booleanFilter(
      'hasSubmissionDate',
      'Submission date',
      'Whether a submission_date is recorded.',
      { label: 'Recorded', count: submitted },
      { label: 'Not recorded', count: applications.length - submitted },
      { category: 'Timeline' },
    ),
  ]
}

export function companyFilters(): FilterDef[] {
  const companies = listCompanies()
  return [
    fieldFilter(companies, 'profileStatus', 'Profile status', 'profile_status', 'How complete this company profile is.'),
    fieldFilter(companies, 'country', 'Country', 'country', 'The country recorded on the company profile.'),
  ]
}

export function organizationFilters(): FilterDef[] {
  return [
    fieldFilter(
      listOrganizations(),
      'organizationType',
      'Organization type',
      'organization_type',
      'Free text as recorded. Not a controlled vocabulary, so the values vary by provider.',
    ),
    fieldFilter(listOrganizations(), 'country', 'Country', 'country', 'The country recorded on the organization.'),
  ]
}

export function sourceFilters(): FilterDef[] {
  const sources = listSources()
  const checked = sources.filter(
    (s) => typeof s.frontmatter.last_checked === 'string' && s.frontmatter.last_checked !== '',
  ).length
  return [
    fieldFilter(
      sources,
      'sourceType',
      'Source type',
      'source_type',
      'Free text as recorded. The vault has no closed list of source kinds.',
    ),
    booleanFilter(
      'hasLastChecked',
      'Last checked',
      'Whether a last_checked date is recorded. The snapshot states no staleness threshold, so no age is computed.',
      { label: 'Recorded', count: checked },
      { label: 'Not recorded', count: sources.length - checked },
    ),
  ]
}