/**
 * Schema definition for the ten record types (six funding, plus Notice, Bid,
 * Contract, and Procurement Match.
 * and Contract).
 *
 * Field names, field order, and value kinds are transcribed from the approved
 * templates (`07 - Templates/*.md`) and the Data Dictionary schema tables.
 * Total: 229 fields.
 *
 * The importer uses this table to VALIDATE each parsed record. It never uses
 * it to repair, reorder into a guess, or fill in a record. A mismatch is
 * reported and stops the import.
 *
 * Per-type constants (ID field, prefix, collection, directory, labels) are not
 * restated here; they come from `types/registry.ts`.
 *
 * ---------------------------------------------------------------------------
 * ONE DOCUMENTED DISCREPANCY (Phase 4, unchanged)
 * "7 required, 37 optional", but only six rows carry the **R** flag: `bid_id`,
 * `company`, `notice`, `eligibility_status`, `bid_decision`, `bid_status`. No
 * seventh row is marked. `pre_bid_attended` reads "Cannot be blank" in its
 * definition column, which `isBlankable` already enforces through its `boolean`
 * kind, so it is a kind constraint rather than a required flag.
 *
 * The six marked rows are implemented as required. Promoting an unmarked field
 * would fabricate a business rule, and demoting a marked one would weaken a
 * gate, so the field-level table wins over the prose header — the same
 * precedence Phase 3 applied to the section 4 Notice table, which that section
 * itself establishes by self-correcting its own totals ("40 stated, 45 listed,
 * 44 corrected"). Both counts sum to 44, so the error is confined to the split.
 * Recorded here, in the Data Dictionary, and in the Phase 4 report rather than
 * resolved silently.
 *
 * ---------------------------------------------------------------------------
 * THE CONTRACT 26-vs-27 DISCREPANCY (resolved in Phase 6)
 * ---------------------------------------------------------------------------
 *
 * Phase 1 section 6 heads the Contract table "Total: 26 fields (7 required, 19
 * optional)" but the table beneath it numbers 27 rows, and section 6's own
 * correction paragraph explains the gap in full: `contract_basis` was added
 * AFTER the 26 count was written, as the necessary consequence of making `bid`
 * optional (invariant 3). The paragraph then states "Authoritative count:
 * Contract = 27 fields", and the roadmap (section 11) and the approval table
 * (section 14) both say 27. The heading's "19 optional" is the pre-
 * `contract_basis` figure; with it, 7 required + 20 optional = 27.
 *
 * So this schema implements 27, and the split is 7/20. The field-level table wins
 * over the prose heading for the same reason Phase 3 and Phase 4 preferred their
 * tables: the table is the field design, and here the document resolves the
 * conflict against itself in the same section. No field is invented and none is
 * dropped to reach either number.
 *
 * A SECOND POINT ON `award_date`. Phase 1 section 6 field 10 deliberately REMOVED
 * `award_date` from Contract — "Replaces the previous award_date duplicate, the
 * award date lives on Bid" — and section 11's Phase 6 acceptance criteria require
 * "no duplicate award date stored on Contract". `Bid.award_date` therefore stays
 * exactly where Phase 4 shipped it, and Contract carries signature, start, end,
 * warranty, and acceptance dates instead. This resolves a conflict between the
 * Phase 6 brief and the Phase 1 authority in favour of the authority, which also
 * satisfies the brief's own "a Contract is not a duplicate Bid" rule.
 */

import {
  ID_FIELD,
  NAME_FIELDS,
  RECORD_DIRS,
  RECORD_REGISTRY,
  RECORD_TYPES,
  TITLE_FIELD,
} from '../types/registry'
import type { RecordType } from '../types/registry'
import { CONTROLLED_VALUES, allowedValuesFor } from './controlled-values'

export type FieldKind =
  | 'text'
  | 'controlled'
  | 'link'
  | 'linkList'
  | 'list'
  | 'date'
  | 'number'
  | 'boolean'

export interface FieldSpec {
  name: string
  kind: FieldKind
  /**
   * Required per the Data Dictionary: a non-blank value must be present.
   *
   * A blank is `""` for text/date/number/link/controlled, `[]` for a list, and
   * is never allowed for a boolean, because `false` is a real recorded value
   * and must stay distinguishable from "not established".
   */
  required: boolean
}

/** The Data Dictionary allows `""` for date fields that are not established. */
export const isBlankable = (k: FieldKind): boolean =>
  k === 'text' || k === 'date' || k === 'number' || k === 'link' || k === 'controlled'

/** The allowed values for a controlled field, from the Data Dictionary table. */
export { allowedValuesFor }

export const SCHEMAS: Record<RecordType, FieldSpec[]> = {
  opportunity: [
    { name: 'opportunity_id', kind: 'text', required: true },
    { name: 'opportunity_name', kind: 'text', required: true },
    { name: 'opportunity_type', kind: 'controlled', required: true },
    { name: 'description', kind: 'text', required: false },
    { name: 'provider', kind: 'link', required: false },
    { name: 'country', kind: 'controlled', required: true },
    { name: 'region', kind: 'list', required: false },
    { name: 'industry', kind: 'list', required: false },
    { name: 'company_stage', kind: 'list', required: false },
    { name: 'beneficiary_type', kind: 'list', required: false },
    { name: 'benefit_type', kind: 'list', required: false },
    { name: 'amount_min', kind: 'number', required: false },
    { name: 'amount_max', kind: 'number', required: false },
    { name: 'currency', kind: 'text', required: false },
    { name: 'benefit_description', kind: 'text', required: false },
    { name: 'matching_funds_required', kind: 'boolean', required: false },
    { name: 'matching_funds_details', kind: 'text', required: false },
    { name: 'eligibility_summary', kind: 'text', required: false },
    { name: 'eligibility_criteria', kind: 'list', required: false },
    { name: 'exclusions', kind: 'list', required: false },
    { name: 'application_open_date', kind: 'date', required: false },
    { name: 'application_deadline', kind: 'date', required: false },
    { name: 'deadline_type', kind: 'controlled', required: false },
    { name: 'application_url', kind: 'text', required: false },
    { name: 'application_method', kind: 'text', required: false },
    { name: 'source_url', kind: 'text', required: false },
    { name: 'verification_status', kind: 'controlled', required: true },
    { name: 'last_verified', kind: 'date', required: false },
    { name: 'record_status', kind: 'controlled', required: true },
    { name: 'notes', kind: 'text', required: false },
  ],
  company: [
    { name: 'company_id', kind: 'text', required: true },
    { name: 'company_name', kind: 'text', required: true },
    { name: 'website', kind: 'text', required: false },
    { name: 'country', kind: 'controlled', required: true },
    { name: 'operating_regions', kind: 'list', required: false },
    { name: 'legal_entity_type', kind: 'text', required: false },
    { name: 'industry', kind: 'list', required: false },
    { name: 'business_description', kind: 'text', required: false },
    { name: 'company_stage', kind: 'text', required: false },
    { name: 'founding_date', kind: 'date', required: false },
    { name: 'employee_count', kind: 'number', required: false },
    { name: 'revenue_range', kind: 'text', required: false },
    { name: 'technology_focus', kind: 'list', required: false },
    { name: 'project_focus', kind: 'list', required: false },
    { name: 'certifications', kind: 'list', required: false },
    { name: 'eligibility_notes', kind: 'text', required: false },
    { name: 'linked_opportunities', kind: 'linkList', required: false },
    { name: 'linked_matches', kind: 'linkList', required: false },
    { name: 'linked_applications', kind: 'linkList', required: false },
    { name: 'profile_status', kind: 'controlled', required: true },
    { name: 'last_updated', kind: 'date', required: false },
  ],
  match: [
    { name: 'match_id', kind: 'text', required: true },
    { name: 'company', kind: 'link', required: true },
    { name: 'opportunity', kind: 'link', required: true },
    { name: 'match_status', kind: 'controlled', required: true },
    { name: 'match_score', kind: 'number', required: false },
    { name: 'match_rationale', kind: 'text', required: false },
    { name: 'eligibility_status', kind: 'controlled', required: true },
    { name: 'criteria_met', kind: 'list', required: false },
    { name: 'criteria_not_met', kind: 'list', required: false },
    { name: 'missing_information', kind: 'list', required: false },
    { name: 'evidence_notes', kind: 'text', required: false },
    { name: 'reviewed_by', kind: 'text', required: false },
    { name: 'review_date', kind: 'date', required: false },
    { name: 'priority', kind: 'controlled', required: false },
    { name: 'next_action', kind: 'text', required: false },
    { name: 'assigned_to', kind: 'text', required: false },
    { name: 'next_review_date', kind: 'date', required: false },
    { name: 'linked_application', kind: 'link', required: false },
    { name: 'last_updated', kind: 'date', required: false },
  ],
  application: [
    { name: 'application_id', kind: 'text', required: true },
    { name: 'company', kind: 'link', required: true },
    { name: 'opportunity', kind: 'link', required: true },
    { name: 'match', kind: 'link', required: false },
    { name: 'application_status', kind: 'controlled', required: true },
    { name: 'assigned_to', kind: 'text', required: false },
    { name: 'application_deadline', kind: 'date', required: false },
    { name: 'preparation_start_date', kind: 'date', required: false },
    { name: 'submission_date', kind: 'date', required: false },
    { name: 'expected_decision_date', kind: 'date', required: false },
    { name: 'next_action', kind: 'text', required: false },
    { name: 'next_action_date', kind: 'date', required: false },
    { name: 'required_documents', kind: 'list', required: false },
    { name: 'completed_documents', kind: 'list', required: false },
    { name: 'requested_amount', kind: 'number', required: false },
    { name: 'requested_currency', kind: 'text', required: false },
    { name: 'awarded_amount', kind: 'number', required: false },
    { name: 'awarded_currency', kind: 'text', required: false },
    { name: 'outcome_notes', kind: 'text', required: false },
    { name: 'last_updated', kind: 'date', required: false },
  ],
  organization: [
    { name: 'organization_id', kind: 'text', required: true },
    { name: 'organization_name', kind: 'text', required: true },
    { name: 'organization_type', kind: 'text', required: false },
    { name: 'country', kind: 'controlled', required: false },
    { name: 'website', kind: 'text', required: false },
    { name: 'description', kind: 'text', required: false },
    { name: 'contact_information', kind: 'text', required: false },
  ],
  source: [
    { name: 'source_id', kind: 'text', required: true },
    { name: 'source_name', kind: 'text', required: true },
    { name: 'source_type', kind: 'text', required: false },
    { name: 'source_url', kind: 'text', required: true },
    { name: 'related_opportunity', kind: 'link', required: false },
    { name: 'publication_date', kind: 'date', required: false },
    { name: 'last_checked', kind: 'date', required: true },
    { name: 'source_notes', kind: 'text', required: false },
  ],
  /**
   * Notice — 53 fields, transcribed field-for-field from the Phase 1
   * Finalization & Architecture Review, section 4 ("Corrected Notice Schema").
   * Order, names, kinds, and required flags follow that table exactly.
   *
   * A Notice is what a BUYER publishes to invite bids. It is not a Bid, not a
   * Contract, and not a funding Opportunity. The distinctions that Phase 1
   * flagged as collision risks are preserved here by name:
   *
   *   - `bid_security_required` / `bid_security_amount` / `bid_security_currency`
   *     are the security the BUYER DEMANDS from any bidder. Phase 4's Bid type
   *     will use `security_posted_*` for what a company actually posted. Same
   *     concept, opposite direction; never the same field.
   *   - `mandatory_bid_documents` is what the buyer requires every bidder to
   *     submit. Phase 4's Bid keeps `required_documents` / `completed_documents`
   *     for one company's own checklist. Phase 1 renamed the Notice field
   *     specifically to avoid the collision.
   *   - `local_content_preference` is the buyer's local/regional content RULE.
   *     It is not the notice's own geography, which `country` and `region`
   *     already carry. Phase 1 renamed `geographic_eligibility` to this.
   *   - There is no `source_url`: `notice_url` is the canonical location and
   *     `linked_sources` carries the evidence. Phase 1 removed the third URL.
   *
   * `bid_submission_datetime` is deliberately `text`, not `date`. A `date`
   * field rejects any time component (see `toIsoDate`), and losing a
   * time-of-day cutoff is a missed-bid risk. It is validated as a datetime
   * string in `validate.ts` instead, and Phase 1 gate 10 checks its date part
   * against `bid_submission_deadline`.
   *
   * Booleans (6): `prequalification_required`, `bid_security_required`,
   * `performance_guarantee_required`, `consortium_allowed`,
   * `subcontracting_allowed`, `overseas_bidder_allowed`. None is blankable.
   */
  notice: [
    /* Identity */
    { name: 'notice_id', kind: 'text', required: true },
    { name: 'notice_name', kind: 'text', required: true },
    { name: 'notice_number', kind: 'text', required: true },
    { name: 'notice_type', kind: 'controlled', required: true },
    { name: 'procurement_method', kind: 'controlled', required: true },
    { name: 'procuring_entity', kind: 'link', required: true },
    { name: 'issuing_platform', kind: 'controlled', required: false },
    { name: 'notice_url', kind: 'text', required: true },
    { name: 'country', kind: 'controlled', required: true },
    { name: 'region', kind: 'list', required: false },
    { name: 'prequalification_required', kind: 'boolean', required: false },
    /* Description */
    { name: 'description', kind: 'text', required: true },
    { name: 'contract_type', kind: 'controlled', required: true },
    { name: 'category', kind: 'list', required: false },
    { name: 'industry', kind: 'list', required: false },
    /* Commercial */
    { name: 'lot_structure', kind: 'controlled', required: true },
    { name: 'number_of_lots', kind: 'number', required: false },
    { name: 'estimated_value', kind: 'number', required: false },
    { name: 'estimated_value_currency', kind: 'text', required: false },
    // Buyer-demanded security, not what any bidder posted.
    { name: 'bid_security_required', kind: 'boolean', required: false },
    { name: 'bid_security_amount', kind: 'number', required: false },
    { name: 'bid_security_currency', kind: 'text', required: false },
    { name: 'performance_guarantee_required', kind: 'boolean', required: false },
    /* Preference & eligibility */
    { name: 'msme_or_small_business_preference', kind: 'text', required: false },
    { name: 'eligibility_summary', kind: 'text', required: false },
    { name: 'eligibility_criteria', kind: 'list', required: false },
    { name: 'technical_qualification_criteria', kind: 'list', required: false },
    { name: 'financial_qualification_criteria', kind: 'list', required: false },
    { name: 'exclusions', kind: 'list', required: false },
    { name: 'consortium_allowed', kind: 'boolean', required: false },
    { name: 'subcontracting_allowed', kind: 'boolean', required: false },
    { name: 'overseas_bidder_allowed', kind: 'boolean', required: false },
    // Free text, not controlled: Phase 1 section 9.2 marks this "Needs research".
    { name: 'local_content_preference', kind: 'text', required: false },
    /* Process & timeline */
    { name: 'issue_date', kind: 'date', required: true },
    { name: 'pre_bid_meeting_date', kind: 'date', required: false },
    { name: 'query_deadline', kind: 'date', required: false },
    { name: 'bid_submission_deadline', kind: 'date', required: false },
    // Intentionally `text`, so a time-of-day cutoff survives.
    { name: 'bid_submission_datetime', kind: 'text', required: false },
    { name: 'bid_opening_date', kind: 'date', required: false },
    { name: 'deadline_type', kind: 'controlled', required: false },
    { name: 'tender_validity_days', kind: 'number', required: false },
    { name: 'evaluation_method', kind: 'controlled', required: false },
    { name: 'award_criteria', kind: 'text', required: false },
    // What the buyer demands from every bidder, not one company's checklist.
    { name: 'mandatory_bid_documents', kind: 'list', required: false },
    { name: 'contract_duration', kind: 'text', required: false },
    /* Governance & evidence */
    { name: 'linked_sources', kind: 'linkList', required: false },
    { name: 'number_of_bids_received', kind: 'number', required: false },
    { name: 'amendment_count', kind: 'number', required: false },
    { name: 'last_amended_date', kind: 'date', required: false },
    { name: 'notice_status', kind: 'controlled', required: true },
    { name: 'verification_status', kind: 'controlled', required: false },
    { name: 'last_verified', kind: 'date', required: false },
    { name: 'notes', kind: 'text', required: false },
  ],

  /**
   * Bid — 44 fields, transcribed field-for-field from the Phase 1
   * Finalization & Architecture Review, section 5 ("Corrected Bid Schema").
   * Order, names, kinds, and required flags follow that table exactly.
   *
   * A Bid is ONE COMPANY'S pursuit of ONE Notice: whether we may bid, whether we
   * chose to, and where the bid stands. It is not the buyer's solicitation (that
   * is Notice, 1:N to this record) and not the post-award instrument (Contract is
   * Phase 6 and deliberately absent).
   *
   * THREE INDEPENDENT AXES. The field groups below are the axes, and they are
   * expected to disagree:
   *
   *   - `eligibility_status` may this company bid at all?
   *   - `bid_decision`       have we chosen to pursue it?
   *   - `bid_status`         where is the bid physically?
   *
   * `Potentially eligible` + `Preparing` + `Bid` is a normal, correct state.
   * Nothing in this schema derives one axis from another, and `validate.ts`
   * gates only the combinations that assert a physical fact contradicting a
   * recorded date (Phase 1 section 8.1).
   *
   * THE COLLISIONS PHASE 1 RENAMED, preserved here by name:
   *
   *   - `security_posted_*` is what OUR company posted. Notice's
   *     `bid_security_*` is what the BUYER DEMANDS from any bidder. Same concept,
   *     opposite direction, never the same field.
   *   - `required_documents` / `completed_documents` are ONE company's checklist.
   *     Notice's `mandatory_bid_documents` is what every bidder must submit.
   *
   * `bid_submission_datetime` is deliberately `text`, not `date`. Phase 1
   * section 10 defect F5 confirms a `date` field throws on any datetime string,
   * and the field exists because a cutoff at 17:00 is not a cutoff at 09:00.
   * Gate 10 checks its date part against `bid_submission_date`.
   *
   * Boolean (1): `pre_bid_attended`. Phase 1 states it cannot be blank, which
   * `isBlankable` already enforces by kind, so it is a kind constraint and not a
   * seventh required flag — see the required-count note below.
   */
  bid: [
    /* Identity & links */
    { name: 'bid_id', kind: 'text', required: true },
    { name: 'company', kind: 'link', required: true },
    { name: 'notice', kind: 'link', required: true },
    { name: 'lot_numbers', kind: 'list', required: false },
    { name: 'pre_bid_attended', kind: 'boolean', required: false },
    /* Axis 1 — Eligibility (vocabulary REUSED from Match) */
    { name: 'eligibility_status', kind: 'controlled', required: true },
    { name: 'criteria_met', kind: 'list', required: false },
    { name: 'criteria_not_met', kind: 'list', required: false },
    { name: 'missing_information', kind: 'list', required: false },
    { name: 'evidence_notes', kind: 'text', required: false },
    { name: 'evidence_sources', kind: 'linkList', required: false },
    { name: 'reviewed_by', kind: 'text', required: false },
    { name: 'review_date', kind: 'date', required: false },
    /* Axis 2 — Decision (go / no-go) */
    { name: 'bid_decision', kind: 'controlled', required: true },
    { name: 'bid_decision_date', kind: 'date', required: false },
    { name: 'bid_decision_rationale', kind: 'text', required: false },
    { name: 'decided_by', kind: 'text', required: false },
    /* Axis 3 — Lifecycle */
    { name: 'bid_status', kind: 'controlled', required: true },
    { name: 'assigned_to', kind: 'text', required: false },
    { name: 'next_action', kind: 'text', required: false },
    { name: 'next_action_date', kind: 'date', required: false },
    { name: 'last_updated', kind: 'date', required: false },
    { name: 'preparation_start_date', kind: 'date', required: false },
    /* Submission */
    { name: 'bid_submission_date', kind: 'date', required: false },
    // Intentionally `text`, so a time-of-day cutoff survives the round trip.
    { name: 'bid_submission_datetime', kind: 'text', required: false },
    { name: 'bid_submission_reference', kind: 'text', required: false },
    /* Evaluation (four scores and two amounts are commercially sensitive) */
    { name: 'technical_score', kind: 'number', required: false },
    { name: 'technical_max_score', kind: 'number', required: false },
    { name: 'financial_score', kind: 'number', required: false },
    { name: 'financial_max_score', kind: 'number', required: false },
    { name: 'quoted_value', kind: 'number', required: false },
    { name: 'quoted_currency', kind: 'text', required: false },
    { name: 'clarification_requests', kind: 'list', required: false },
    /* Security actually posted by this bidder */
    { name: 'security_posted_status', kind: 'controlled', required: false },
    { name: 'security_posted_amount', kind: 'number', required: false },
    { name: 'security_posted_currency', kind: 'text', required: false },
    /* Documents (this bidder's own checklist, a subset rule applies) */
    { name: 'required_documents', kind: 'list', required: false },
    { name: 'completed_documents', kind: 'list', required: false },
    /* Outcome — facts, not status */
    { name: 'award_date', kind: 'date', required: false },
    { name: 'awarded_lot', kind: 'text', required: false },
    { name: 'awarded_value', kind: 'number', required: false },
    { name: 'awarded_currency', kind: 'text', required: false },
    { name: 'outcome_notes', kind: 'text', required: false },
    { name: 'contract_basis', kind: 'controlled', required: false },
  ],
  contract: [
    /* Identity & links. `bid` is the one optional link in the procurement
     * model: a single-source or negotiated award produces a Contract with no
     * competing Bid, and invariant 3 compensates with a required
     * `contract_basis` in that case. */
    { name: 'contract_id', kind: 'text', required: true },
    { name: 'notice', kind: 'link', required: true },
    { name: 'bid', kind: 'link', required: false },
    { name: 'company', kind: 'link', required: true },
    { name: 'lot_number', kind: 'text', required: false },
    { name: 'contract_number', kind: 'text', required: true },
    { name: 'contract_title', kind: 'text', required: false },
    /* Money. Split into two fields per Phase 1 section 2.4, which found the
     * previous compound "contract_value + currency" ambiguous. 🔒 pairs with
     * `contract_value_currency`; see invariant 12 on never summing currencies. */
    { name: 'contract_value', kind: 'number', required: true },
    { name: 'contract_value_currency', kind: 'text', required: true },
    /* Dates. Deliberately NO `award_date`: Phase 1 section 6 field 10 replaced
     * the old duplicate, because `Bid.award_date` owns the competitive outcome
     * and Phase 6 acceptance criteria forbid storing it twice. */
    { name: 'contract_signature_date', kind: 'date', required: false },
    { name: 'contract_start_date', kind: 'date', required: false },
    { name: 'contract_end_date', kind: 'date', required: false },
    /* Scope & milestones */
    { name: 'delivery_scope', kind: 'text', required: false },
    { name: 'milestones', kind: 'list', required: false },
    /* Performance security */
    // "Cannot be blank" in the Phase 1 table, so `isBlankable` enforces it
    // through the `boolean` kind rather than the required flag. Same treatment
    // Phase 4 gave Bid's `pre_bid_attended`.
    { name: 'performance_guarantee_required', kind: 'boolean', required: false },
    { name: 'performance_guarantee_amount', kind: 'number', required: false },
    { name: 'performance_guarantee_currency', kind: 'text', required: false },
    { name: 'performance_security_status', kind: 'controlled', required: false },
    /* Acceptance */
    { name: 'acceptance_status', kind: 'controlled', required: false },
    { name: 'acceptance_date', kind: 'date', required: false },
    /* Payment */
    { name: 'payment_status', kind: 'controlled', required: false },
    { name: 'payment_received_to_date', kind: 'number', required: false },
    { name: 'retention_percentage', kind: 'number', required: false },
    { name: 'warranty_end_date', kind: 'date', required: false },
    /* Lifecycle. The one required controlled field on Contract. */
    { name: 'contract_status', kind: 'controlled', required: true },
    // Owned by Bid, and REUSED here unchanged rather than redeclared with its own
    // vocabulary: one question ("why was there no competition?") gets one answer
    // set, exactly as Phase 1 decision D8 reused `eligibility_status`.
    { name: 'contract_basis', kind: 'controlled', required: false },
    { name: 'notes', kind: 'text', required: false },
  ],
  /**
   * Procurement Match — Phase P founder decision (procurement requires
   * automation equivalent to funding, as a separate type; the funding Match
   * is untouched). A reviewed pairing of one Notice/RFP with one Company.
   *
   * The smallest useful field set: identity, the two required relationship
   * links (Notice, Company — never Opportunity, Bid, or Contract), the shared
   * workflow assessments (`match_status`, and `eligibility_status` reused per
   * D8), reviewer evidence, and reviewer identity. Deliberately absent: any
   * score or confidence (the vault documents no scoring method), generated
   * rationale or criteria, duplicated Notice/Company facts, and any other
   * workflow field not yet required.
   */
  procurement_match: [
    { name: 'procurement_match_id', kind: 'text', required: true },
    { name: 'notice', kind: 'link', required: true },
    { name: 'company', kind: 'link', required: true },
    { name: 'match_status', kind: 'controlled', required: true },
    { name: 'eligibility_status', kind: 'controlled', required: true },
    { name: 'evidence_notes', kind: 'text', required: false },
    { name: 'missing_information', kind: 'list', required: false },
    { name: 'reviewed_by', kind: 'text', required: false },
    { name: 'review_date', kind: 'date', required: false },
  ],
}

/** 238 across every registered type: 105 funding + 53 Notice + 44 Bid + 27 Contract + 9 Procurement Match. */
export const TOTAL_SCHEMA_FIELDS = RECORD_TYPES.reduce(
  (n, t) => n + SCHEMAS[t].length,
  0,
)

/** Required fields across every registered schema. */
export const TOTAL_REQUIRED_FIELDS = RECORD_TYPES.reduce(
  (n, t) => n + SCHEMAS[t].filter((f) => f.required).length,
  0,
)

/** Fields whose values may legitimately be `""`. */
export const BLANKABLE_FIELDS = RECORD_TYPES.flatMap((t) =>
  SCHEMAS[t].filter((f) => isBlankable(f.kind)).map((f) => `${t}.${f.name}`),
)

/** Field name -> spec, for the single type that declares it. Fields are unique. */
export const FIELD_SPEC: Readonly<Record<string, FieldSpec>> = Object.fromEntries(
  RECORD_TYPES.flatMap((t) => SCHEMAS[t].map((spec) => [spec.name, spec] as const)),
)

/** Every controlled field name in the registered schemas, deduplicated. */
export const CONTROLLED_FIELD_NAMES: readonly string[] = [
  ...new Set(RECORD_TYPES.flatMap((t) => SCHEMAS[t].filter((f) => f.kind === 'controlled').map((f) => f.name))),
]

/**
 * Fail fast on a schema that has drifted from the registry or from the
 * controlled-value table. Called by the importer before any file is read, so a
 * misconfiguration is a startup error rather than 25 confusing per-record ones.
 *
 * The checks are structural only. They cannot tell you a field's `kind` is
 * *correct*, only that it is internally consistent.
 */
export function assertSchemaConsistency(): void {
  const problems: string[] = []

  for (const type of RECORD_TYPES) {
    const schema = SCHEMAS[type]
    if (!schema || schema.length === 0) {
      problems.push(`${type}: no schema defined`)
      continue
    }

    const names = schema.map((f) => f.name)
    const dupes = names.filter((n, i) => names.indexOf(n) !== i)
    if (dupes.length > 0) problems.push(`${type}: duplicate fields ${[...new Set(dupes)].join(', ')}`)

    if (schema[0].name !== ID_FIELD[type]) {
      problems.push(`${type}: first field is "${schema[0].name}", expected the ID field "${ID_FIELD[type]}"`)
    }
    if (!schema.some((f) => f.name === TITLE_FIELD[type])) {
      problems.push(`${type}: title field "${TITLE_FIELD[type]}" is not in the schema`)
    }
    if (RECORD_DIRS[type].trim() === '') problems.push(`${type}: no vault directory in the registry`)
  }

  for (const name of CONTROLLED_FIELD_NAMES) {
    if (!CONTROLLED_VALUES[name]) problems.push(`controlled field "${name}" has no allowed-value list`)
  }
  for (const name of Object.keys(CONTROLLED_VALUES)) {
    if (!CONTROLLED_FIELD_NAMES.includes(name)) {
      problems.push(`allowed-value list "${name}" has no controlled field in the schema`)
    }
  }

  for (const type of RECORD_TYPES) {
    for (const name of NAME_FIELDS[type]) {
      if (!SCHEMAS[type].some((f) => f.name === name)) {
        problems.push(`${type}: name-marker field "${name}" is not in the schema`)
      }
    }
    for (const link of RECORD_REGISTRY[type].links) {
      const spec = SCHEMAS[type].find((f) => f.name === link.field)
      if (!spec) problems.push(`${type}: approved link field "${link.field}" is not in the schema`)
      else if (spec.kind !== 'link' && spec.kind !== 'linkList') {
        // Either cardinality is a relationship. `link` is N:1 (Notice ->
        // procuring_entity); `linkList` is N:N (Notice -> linked_sources).
        // Phase 1 section 7.2 specifies both for Notice, so the registry
        // declares the field and this check only insists it is a link of some
        // kind. It never widens: a non-link kind is still an error.
        problems.push(
          `${type}.${link.field}: approved relationship field must be kind "link" or "linkList", is "${spec.kind}"`,
        )
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(`Schema is inconsistent with the registry:\n  - ${problems.join('\n  - ')}`)
  }
}
