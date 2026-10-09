/**
 * Typed models for the ten TVB record types: the six funding types plus
 * Notice (Phase 3), Bid (Phase 4), Contract (Phase 6), and Procurement Match
 * (Phase P).
 *
 * These mirror the approved Data Dictionary and the nine approved templates
 * exactly: 229 fields in total, in template field order. Nothing here is
 * invented, and no field is added or removed.
 *
 * Three states are kept deliberately distinct, because the source vault
 * distinguishes them and Phase 1.1 verified the difference matters:
 *
 *   1. BLANK STRING  `""`        -> a field that is present but deliberately
 *                                    empty (e.g. `match_score: ""`).
 *   2. EMPTY LIST    `[]`        -> a list field with no entries.
 *   3. MISSING KEY    (absent)   -> the key is not present at all.
 *
 * A `?` on a field means the key MAY be absent. It never means the value may
 * be blank. `match_score?: BlankableNumber` therefore accepts `""`, a real
 * number, or an absent key, and the importer keeps all three apart.
 */

/** A `YYYY-MM-DD` date exactly as written in the source. Never a JS Date. */
export type IsoDate = string

/** Deliberately empty text. Must survive import as `""`, never as null. */
export type BlankString = ''

/** A numeric field that is allowed to be deliberately blank in the source. */
export type BlankableNumber = number | BlankString

/** A scalar wikilink, preserved verbatim including its `[[...]]` wrapper. */
export type LinkField = string

/** A list field. May be empty (`[]`); that is not the same as blank. */
export type ListField = string[]

/**
 * A date field is either blank (`""`) or an ISO date string. The source
 * vault uses blank for "not established", e.g. a rolling deadline.
 */
export type DateField = IsoDate | BlankString

/* ------------------------------------------------------------------ */
/* Controlled value unions                                              */
/* ------------------------------------------------------------------ */

export type OpportunityType = 'Grant' | 'Fund' | 'Subsidy' | 'Incentive' | 'Program'
export type Country = 'India' | 'USA'
export type DeadlineType = 'Fixed' | 'Rolling' | 'Recurring' | 'Unknown'
export type VerificationStatus = 'Unverified' | 'Verified' | 'Needs review'
export type OpportunityRecordStatus = 'Upcoming' | 'Active' | 'Closed' | 'Archived'
export type ProfileStatus = 'Draft' | 'Needs review' | 'Verified' | 'Archived'
export type MatchStatus =
  | 'New'
  | 'Under review'
  | 'Matched'
  | 'Not a match'
  | 'Needs information'
export type EligibilityStatus =
  | 'Not assessed'
  | 'Potentially eligible'
  | 'Eligible—verified'
  | 'Ineligible'
  | 'Needs more information'
export type ApplicationStatus =
  | 'Researching'
  | 'Preparing'
  | 'Submitted'
  | 'Under review'
  | 'Awarded'
  | 'Rejected'
  | 'Withdrawn'
  | 'On hold'
export type Priority = 'Low' | 'Medium' | 'High' | 'Critical'

/* ---- Notice controlled vocabularies (Phase 1 Finalization, section 4) ---- */

export type NoticeType = 'RFB' | 'RFQ' | 'RFP' | 'RTE' | 'EOI' | 'Tender' | 'Single source' | 'Other'
export type ProcurementMethod =
  | 'Open'
  | 'Limited'
  | 'Single source'
  | 'E-auction'
  | 'Direct purchase'
  | 'GeM direct'
  | 'Other'
export type IssuingPlatform =
  | 'GeM'
  | 'CPPP'
  | 'eProcure'
  | 'SAM.gov'
  | 'State portal'
  | 'Offline'
  | 'Aggregator'
  | 'Other'
export type LotStructure = 'Single lot' | 'Multi lot'
export type ContractType = 'Goods' | 'Services' | 'Works' | 'Mixed'
export type EvaluationMethod =
  | 'Lowest price'
  | 'Lowest evaluated price'
  | 'Combined technical and price'
  | 'Quality and cost based'
  | 'Single bid'
  | 'Not stated'
export type NoticeStatus =
  | 'Draft'
  | 'Published'
  | 'Open'
  | 'Closed'
  | 'Under evaluation'
  | 'Awarded'
  | 'Cancelled'
  | 'Archived'

/* ---- Bid controlled vocabularies (Phase 1 Finalization, section 5) ---- */

/**
 * Axis 2 — the go/no-go decision. Independent of both other axes.
 *
 * `No bid` is a recorded outcome, not an absence of a record: Phase 1 section 5
 * calls `bid_decision_rationale` "the record's durable institutional value; a
 * no-bid must be recorded, not simply omitted".
 */
export type BidDecision = 'Pending' | 'Bid' | 'No bid' | 'Deferred'

/**
 * Axis 3 — where the bid physically stands. Independent of both other axes.
 *
 * `Opened` is retained although Phase 1 section 8.4 records it as an open
 * decision: it is meaningful for a sealed tender, harmless when unused, and
 * removing it would be an unapproved schema change.
 */
export type BidStatus =
  | 'Researching'
  | 'Preparing'
  | 'Submitted'
  | 'Opened'
  | 'Under evaluation'
  | 'Clarification'
  | 'Awarded'
  | 'Not awarded'
  | 'Withdrawn'
  | 'Cancelled'
  | 'On hold'

/**
 * What one bidder actually posted.
 *
 * Never confused with Notice's `bid_security_required` / `_amount` /
 * `_currency`, which describe what the BUYER DEMANDS from any bidder. Phase 1
 * renamed the Bid side specifically to make the direction unmistakable.
 */
export type SecurityPostedStatus =
  | 'Not required'
  | 'Not submitted'
  | 'Submitted'
  | 'Released'
  | 'Forfeited'

/** Why an award happened without a competing bid. Blank on a competitive award. */
export type ContractBasis =
  | 'Awarded after competitive bid'
  | 'Single source'
  | 'Negotiated'
  | 'Letter of intent'
  | 'Direct award'

/**
 * Where a Contract stands. Phase 1 section 8.6 fixes the shape:
 *
 *   Awarded -> Active -> Delivered -> Accepted -> Completed
 *                +-> Under dispute -> Active | Terminated
 *                +-> Terminated
 *
 * `Awarded` is the instant the obligation is recorded; `Active` is the same
 * moment with the clock started. `Delivered` is our hand-over, `Accepted` is the
 * buyer's sign-off, and `Completed` is the contract's own term closing.
 */
export type ContractStatus =
  | 'Awarded'
  | 'Active'
  | 'Delivered'
  | 'Accepted'
  | 'Under dispute'
  | 'Terminated'
  | 'Completed'

/**
 * What the buyer has done with the performance security WE posted. Distinct
 * from `PerformanceGuaranteeRequired`, which is a boolean about whether the
 * buyer demands security at all — a requirement, not a state.
 */
export type PerformanceSecurityStatus =
  | 'Not required'
  | 'Not submitted'
  | 'Submitted'
  | 'Released'
  | 'Forfeited'
  | 'Claimed'

/** Whether the buyer has accepted what we delivered. Independent of payment. */
export type AcceptanceStatus =
  | 'Not applicable'
  | 'Pending'
  | 'Under inspection'
  | 'Accepted'
  | 'Rejected'

/** Whether we have been paid. Independent of acceptance: terms may net 60. */
export type PaymentStatus =
  | 'Not started'
  | 'Partially paid'
  | 'Fully paid'
  | 'Withheld'
  | 'Disputed'

/* ------------------------------------------------------------------ */
/* Record frontmatter (30 + 21 + 19 + 20 + 7 + 8 + 53 + 44 + 27 = 229) */
/* ------------------------------------------------------------------ */

/** 30 fields. */
export interface Opportunity {
  opportunity_id: string
  opportunity_name: string
  opportunity_type: OpportunityType | string
  description: string
  provider: LinkField
  country: Country | string
  region: ListField
  industry: ListField
  company_stage: ListField
  beneficiary_type: ListField
  benefit_type: ListField
  amount_min: BlankableNumber
  amount_max: BlankableNumber
  currency: string
  benefit_description: string
  matching_funds_required: boolean
  matching_funds_details: string
  eligibility_summary: string
  eligibility_criteria: ListField
  exclusions: ListField
  application_open_date: DateField
  application_deadline: DateField
  deadline_type: DeadlineType | string
  application_url: string
  application_method: string
  source_url: string
  verification_status: VerificationStatus | string
  /** Intentionally independent of any document timestamp. Never derived. */
  last_verified: DateField
  record_status: OpportunityRecordStatus | string
  notes: string
}

/** 21 fields. */
export interface Company {
  company_id: string
  company_name: string
  website: string
  country: Country | string
  operating_regions: ListField
  legal_entity_type: string
  industry: ListField
  business_description: string
  company_stage: string
  founding_date: DateField
  employee_count: BlankableNumber
  revenue_range: string
  technology_focus: ListField
  project_focus: ListField
  certifications: ListField
  eligibility_notes: string
  linked_opportunities: ListField
  linked_matches: ListField
  linked_applications: ListField
  profile_status: ProfileStatus | string
  last_updated: DateField
}

/** 19 fields. */
export interface Match {
  match_id: string
  company: LinkField
  opportunity: LinkField
  match_status: MatchStatus | string
  /** Blank in all four current records. Never inferred, never defaulted. */
  match_score: BlankableNumber
  match_rationale: string
  eligibility_status: EligibilityStatus | string
  criteria_met: ListField
  criteria_not_met: ListField
  missing_information: ListField
  evidence_notes: string
  reviewed_by: string
  review_date: DateField
  priority: Priority | string
  next_action: string
  assigned_to: string
  next_review_date: DateField
  linked_application: LinkField
  last_updated: DateField
}

/** 20 fields. */
export interface Application {
  application_id: string
  company: LinkField
  opportunity: LinkField
  match: LinkField
  application_status: ApplicationStatus | string
  assigned_to: string
  application_deadline: DateField
  preparation_start_date: DateField
  submission_date: DateField
  expected_decision_date: DateField
  next_action: string
  next_action_date: DateField
  required_documents: ListField
  completed_documents: ListField
  requested_amount: BlankableNumber
  requested_currency: string
  awarded_amount: BlankableNumber
  awarded_currency: string
  outcome_notes: string
  last_updated: DateField
}

/** 7 fields. Has no link field; see bodyLinks for Organization -> Opportunity. */
export interface Organization {
  organization_id: string
  organization_name: string
  organization_type: string
  country: Country | string
  website: string
  description: string
  contact_information: string
}

/** 8 fields. `related_opportunity` is the authoritative Source -> Opportunity join. */
export interface Source {
  source_id: string
  source_name: string
  source_type: string
  source_url: string
  related_opportunity: LinkField
  publication_date: DateField
  last_checked: DateField
  source_notes: string
}

/**
 * 53 fields. Transcribed field-for-field from the Phase 1 Finalization &
 * Architecture Review, section 4 ("Corrected Notice Schema"), in that order.
 *
 * A Notice is a BUYER's published procurement solicitation: what they want,
 * who they are, what they demand to bid, and by when. It is the procurement
 * master record.
 *
 * It is NOT:
 *   - a Bid       (Phase 4). One company's decision to bid. Notice is 1:N Bid.
 *   - a Contract  (Phase 6). The post-award instrument.
 *   - an Opportunity. A Notice is demand-side procurement, not funding. There
 *     is deliberately no Notice -> Opportunity link (Phase 1 decision D12).
 *
 * Two field families exist here ONLY because the buyer demands them. They must
 * never be read as what one company did:
 *
 *   - `bid_security_*` is the security the BUYER DEMANDS from any bidder.
 *     Phase 4's Bid uses `security_posted_*` for what a company posted.
 *   - `mandatory_bid_documents` is what the buyer requires EVERY bidder to
 *     submit. Phase 4's Bid keeps `required_documents` / `completed_documents`
 *     for a single company's own checklist.
 *
 * `bid_submission_datetime` is `string`, not `DateField`, because it carries a
 * time of day that the vault's date-only convention would discard. It is
 * `""` or a string like `2026-11-04 17:00 IST`.
 *
 * The two country-specific preference fields are free text, not unions,
 * because Phase 1 section 9.2 marks both "Needs research" and no procurement
 * source exists in the project. See `src/import/controlled-values.ts`.
 */
export interface Notice {
  /* Identity */
  notice_id: string
  notice_name: string
  notice_number: string
  notice_type: string
  procurement_method: string
  procuring_entity: LinkField
  issuing_platform: string
  notice_url: string
  country: string
  region: ListField
  prequalification_required: boolean
  /* Description */
  description: string
  contract_type: string
  category: ListField
  industry: ListField
  /* Commercial */
  lot_structure: string
  number_of_lots: BlankableNumber
  estimated_value: BlankableNumber
  estimated_value_currency: string
  bid_security_required: boolean
  bid_security_amount: BlankableNumber
  bid_security_currency: string
  performance_guarantee_required: boolean
  /* Preference & eligibility */
  msme_or_small_business_preference: string
  eligibility_summary: string
  eligibility_criteria: ListField
  technical_qualification_criteria: ListField
  financial_qualification_criteria: ListField
  exclusions: ListField
  consortium_allowed: boolean
  subcontracting_allowed: boolean
  overseas_bidder_allowed: boolean
  local_content_preference: string
  /* Process & timeline */
  issue_date: DateField
  pre_bid_meeting_date: DateField
  query_deadline: DateField
  bid_submission_deadline: DateField
  bid_submission_datetime: string
  bid_opening_date: DateField
  deadline_type: string
  tender_validity_days: BlankableNumber
  evaluation_method: string
  award_criteria: string
  mandatory_bid_documents: ListField
  contract_duration: string
  /* Governance & evidence */
  linked_sources: ListField
  number_of_bids_received: BlankableNumber
  amendment_count: BlankableNumber
  last_amended_date: DateField
  notice_status: string
  verification_status: string
  last_verified: DateField
  notes: string
}

/**
 * 44 fields. Transcribed field-for-field from the Phase 1 Finalization &
 * Architecture Review, section 5 ("Corrected Bid Schema"), in that order.
 *
 * A Bid is ONE COMPANY'S record of pursuing ONE Notice. It answers three
 * separate questions and deliberately keeps their answers apart:
 *
 *   1. `eligibility_status` — may this company bid at all?
 *   2. `bid_decision`       — have we chosen to pursue it?
 *   3. `bid_status`         — where does the bid physically stand?
 *
 * Those states are EXPECTED to disagree. There is no single "bid status" here,
 * because collapsing the three is the modelling error Phase 1 section 8.1
 * prohibits.
 *
 * It is NOT:
 *   - a Notice. The buyer publishes the solicitation; this is our response to it.
 *     A Notice has 1:N Bids, so several companies may each hold their own Bid.
 *   - a Contract. Phase 6, and deliberately absent. Award facts live here so
 *     procurement is usable end to end without it.
 *   - an Opportunity. Bid has no Opportunity or Match link at all; Phase 1
 *     section 7.2 rules Match out of procurement entirely.
 *
 * Two field families exist here ONLY because of what WE did, and must never be
 * confused with the buyer's demands recorded on Notice:
 *
 *   - `security_posted_*` is what our company posted. Notice's `bid_security_*`
 *     is what the buyer demands from any bidder.
 *   - `required_documents` / `completed_documents` are one bidder's own
 *     checklist. Notice's `mandatory_bid_documents` is what every bidder submits.
 *
 * `bid_submission_datetime` is `string`, not `DateField`, because it carries a
 * time of day that the vault's date-only convention would discard. It is `""` or
 * a string like `2026-11-04 17:03 IST`, and its date part must equal
 * `bid_submission_date` (Phase 1 gate 10).
 *
 * The three currency fields are free text, not unions. Phase 1 section 9.2 marks
 * every jurisdiction-specific value "Needs research" and no procurement source
 * exists in the project. See `src/import/controlled-values.ts`.
 *
 * Six required fields, not seven: Phase 1 section 5 heads its table "7 required,
 * 37 optional" but marks only six rows. See the note at the top of
 * `import/schema.ts`.
 */
export interface Bid {
  /* Identity & links */
  bid_id: string
  /** Exactly one. Phase 1 decision D6 keeps a consortium out of the MVP, so
   *  this stays a single link and is never a list. */
  company: LinkField
  /** Exactly one. A Bid without its Notice is not a procurement record. */
  notice: LinkField
  lot_numbers: ListField
  pre_bid_attended: boolean
  /* Axis 1 — Eligibility */
  eligibility_status: EligibilityStatus | string
  criteria_met: ListField
  criteria_not_met: ListField
  missing_information: ListField
  evidence_notes: string
  /** Phase 1 gate 5 requires this non-empty at `Eligible—verified`, closing the
   *  gap the Match evidence fields leave open. */
  evidence_sources: ListField
  reviewed_by: string
  review_date: DateField
  /* Axis 2 — Decision */
  bid_decision: BidDecision | string
  bid_decision_date: DateField
  bid_decision_rationale: string
  decided_by: string
  /* Axis 3 — Lifecycle */
  bid_status: BidStatus | string
  assigned_to: string
  next_action: string
  next_action_date: DateField
  last_updated: DateField
  preparation_start_date: DateField
  /* Submission */
  bid_submission_date: DateField
  bid_submission_datetime: string
  bid_submission_reference: string
  /* Evaluation — commercially sensitive */
  technical_score: BlankableNumber
  technical_max_score: BlankableNumber
  financial_score: BlankableNumber
  financial_max_score: BlankableNumber
  quoted_value: BlankableNumber
  quoted_currency: string
  clarification_requests: ListField
  /* Security posted by this bidder */
  security_posted_status: SecurityPostedStatus | string
  security_posted_amount: BlankableNumber
  security_posted_currency: string
  /* Documents — Phase 1 gate 11 subsets this against required_documents */
  required_documents: ListField
  completed_documents: ListField
  /* Outcome — facts, not status */
  award_date: DateField
  awarded_lot: string
  awarded_value: BlankableNumber
  awarded_currency: string
  outcome_notes: string
  contract_basis: ContractBasis | string
}

/**
 * A post-award instrument: what we are contractually obliged to deliver, for how
 * much, and where delivery, acceptance, and payment stand.
 *
 * There is deliberately NO `award_date` field. Phase 1 section 6 removed it as a
 * duplicate: `Bid.award_date` owns the competitive outcome, and Phase 6's
 * acceptance criteria require that the award date not be stored twice. What this
 * type owns instead is everything that happens AFTER the award — signature,
 * commencement, expiry, delivery, acceptance, warranty, and payment.
 *
 * `bid` is the one optional link in the procurement model. A single-source or
 * negotiated award produces a Contract with no competing Bid; invariant 3 makes
 * `contract_basis` mandatory in exactly that case, so a blank `bid` is a
 * recorded fact rather than missing data. This is why `Bid -> Contract` is
 * 1:0..N and not 1:1: one award can produce a contract per awarded lot.
 */
export interface Contract {
  /* Identity & links */
  contract_id: string
  /** Exactly one. The procurement this arose from. Required even when `bid` is
   *  blank: a single-source award still descends from a published notice. */
  notice: LinkField
  /** Optional. Absent for a non-competitive award; see `contract_basis`. */
  bid: LinkField
  /** Exactly one. The awarded counterparty. */
  company: LinkField
  lot_number: string
  contract_number: string
  contract_title: string
  /* Money. Split per Phase 1 section 2.4; never summed across currencies. */
  contract_value: number
  /** Required, so a Contract can never carry a bare amount. Free text. */
  contract_value_currency: string
  /* Dates. No award_date: it belongs to Bid. */
  contract_signature_date: DateField
  contract_start_date: DateField
  contract_end_date: DateField
  /* Scope & milestones */
  delivery_scope: string
  milestones: ListField
  /* Performance security */
  performance_guarantee_required: boolean
  performance_guarantee_amount: BlankableNumber
  performance_guarantee_currency: string
  performance_security_status: PerformanceSecurityStatus | string
  /* Acceptance */
  acceptance_status: AcceptanceStatus | string
  acceptance_date: DateField
  /* Payment */
  payment_status: PaymentStatus | string
  payment_received_to_date: BlankableNumber
  retention_percentage: BlankableNumber
  warranty_end_date: DateField
  /* Lifecycle */
  contract_status: ContractStatus | string
  /** Required when `bid` is blank (Phase 1 invariant 3). Vocabulary shared
   *  with Bid, because the question is the same one. */
  contract_basis: ContractBasis | string
  notes: string
}

/**
 * Procurement Match (Phase P founder decision: procurement requires automation
 * equivalent to funding, as a separate type — the funding Match is untouched).
 *
 * A reviewed pairing of one Notice/RFP with one Company. The smallest useful
 * field set: identity, the two required relationship links, workflow-state
 * assessments reused from the shared vocabularies (`match_status`,
 * `eligibility_status` — D8 blesses the latter's reuse), reviewer evidence,
 * and reviewer identity. Deliberately absent: any score or confidence (the
 * vault documents no scoring method), generated rationale or criteria (human
 * assessment content), duplicated Notice/Company facts, and any link to
 * Opportunity, Bid, or Contract.
 */
export interface ProcurementMatch {
  procurement_match_id: string
  notice: LinkField
  company: LinkField
  match_status: MatchStatus | string
  eligibility_status: EligibilityStatus | string
  evidence_notes: string
  missing_information: ListField
  reviewed_by: string
  review_date: DateField
}

/* ------------------------------------------------------------------ */
/* Import envelope                                                     */
/* ------------------------------------------------------------------ */

import type { RecordType } from './registry'

/**
 * `RecordType` and `ID_FIELD` are owned by the registry, which is the single
 * source of truth for per-type constants. They are re-exported here so the
 * many existing `types/records` imports keep working unchanged.
 */
export type { RecordType }
export { ID_FIELD } from './registry'

/** Frontmatter shape for any record, before it is narrowed to its interface. */
export type Frontmatter = Record<string, unknown>

/** A wikilink target as it appeared in the source, plus any resolution. */
export interface LinkTarget {
  /** The exact text inside `[[ ]]`, e.g. `OPP-001 — Startup India Seed Fund Scheme — SISFS`. */
  target: string
  /** The `[[...]]` string exactly as written in the source, including aliases. */
  raw: string
  /** Resolved record ID, or null when the link points at no record. */
  resolvedId: string | null
  /**
   * Vault-relative path when the link points at a non-record note (for
   * example `[[Data Dictionary]]`). Such a link is a documentation link, not
   * a relationship, and is never used as a relationship key.
   */
  notePath: string | null
  /** True only when the link points at nothing that exists in the vault. */
  unresolved: boolean
}

/** Frontmatter links for one record, keyed by field name. */
export interface RecordLinks {
  /** Field name -> link targets, in field order. */
  fields: Record<string, LinkTarget[]>
  /** Wikilinks found in the Markdown body. Never used as a relationship key. */
  body: LinkTarget[]
}

/** Which rule classified a record as fictional demonstration data. */
export interface FictionalEvidence {
  isFictional: boolean
  /** Human-readable rules that fired, e.g. `filename-marker`. */
  rules: string[]
  /** True when a record could not be classified confidently. */
  ambiguous: boolean
  note: string
}

/** One record as imported, with source provenance and derived classification. */
export interface ImportedRecord<T = Frontmatter> {
  /** Stable join key, e.g. `OPP-001`. Taken from the source ID field. */
  id: string
  type: RecordType
  /** Vault-relative path, forward slashes, e.g. `01 - Opportunities/OPP-001 — ....md`. */
  sourceFile: string
  /** SHA-256 of the source file at import time. */
  sourceSha256: string
  /** Field values exactly as parsed, with schema field order preserved. */
  frontmatter: T
  /** Markdown body, preserved verbatim (leading newline trimmed only). */
  body: string
  fictional: FictionalEvidence
  links: RecordLinks
}

/**
 * A record as the UI layer consumes it: fully typed envelope, but frontmatter
 * NOT narrowed to a per-type interface.
 *
 * The six per-type interfaces (`Opportunity`, `Company`, ...) are plain
 * interfaces with no index signature, so they are not assignable to
 * `Record<string, unknown>`. Field access therefore goes through
 * `field(rec, name)` in the selector layer, which is the single place the
 * narrowing happens. This type exists so the whole UI shares one row type
 * instead of casting at every call site.
 */
export type RecordRow = ImportedRecord<Record<string, unknown>>

/** A link that could not be resolved to a record, reported rather than dropped. */
export interface UnresolvedLink {
  fromId: string
  fromType: RecordType
  /** `frontmatter` or `body`. */
  origin: 'frontmatter' | 'body'
  field: string
  raw: string
  target: string
}

/** Derived, ID-keyed relationship indexes. All keys are original record IDs. */
export interface Relationships {
  /** Organization ID -> Opportunity IDs, from `Opportunity.provider` (reversed). */
  organizationToOpportunity: Record<string, string[]>
  /** Source ID -> Opportunity ID, from `Source.related_opportunity`. */
  sourceToOpportunity: Record<string, string[]>
  /** Match ID -> { company, opportunity, application|null }. */
  matchToCompany: Record<string, string>
  matchToOpportunity: Record<string, string>
  matchToApplication: Record<string, string | null>
  /** Application ID -> { company, opportunity, match|null }. */
  applicationToCompany: Record<string, string>
  applicationToOpportunity: Record<string, string>
  applicationToMatch: Record<string, string | null>
  /** Opportunity ID -> Source IDs pointing at it. */
  opportunityToSource: Record<string, string[]>
  /**
   * Notice -> Organization that issued it, from `Notice.procuring_entity`.
   *
   * Phase 1 section 7.2 records this as N:1. Reuses Organization unchanged; no
   * link field was added to Organization for procurement.
   */
  noticeToOrganization: Record<string, string>
  /** Notice ID -> Source IDs in `Notice.linked_sources`. Phase 1: N:N. */
  noticeToSource: Record<string, string[]>

  /**
   * Bid ID -> the single Company it was submitted by, from `Bid.company`.
   * Phase 1 section 7.2: N:1, required. Consortiums are deferred (D6), so this
   * resolves to exactly one ID and never a list.
   */
  bidToCompany: Record<string, string>
  /**
   * Bid ID -> the single Notice it pursues, from `Bid.notice`.
   * Phase 1 section 7.2: N:1, required.
   */
  bidToNotice: Record<string, string>
  /**
   * Bid ID -> Source IDs in `Bid.evidence_sources`.
   *
   * Phase 1 section 7.2: N:N. This is the evidence behind an eligibility
   * assessment, and gate 5 requires it non-empty at `Eligible—verified`. Distinct
   * from `noticeToSource`, which is the evidence behind the solicitation itself:
   * a notice's corrigendum and a bid's eligibility review are different evidence
   * for different claims.
   */
  bidToSource: Record<string, string[]>

  /**
   * Notice ID -> Bid IDs pursuing it. The reverse of `bidToNotice`, and the
   * index that makes the Notice 1:N Bid cardinality queryable: "how many of us
   * bid on this tender?" has one answer instead of requiring a scan.
   */
  noticeToBid: Record<string, string[]>
  /**
   * Company ID -> Bid IDs it submitted. The reverse of `bidToCompany`, and the
   * index behind the pipeline view of one company's procurement history.
   */
  companyToBid: Record<string, string[]>
  /**
   * Source ID -> Bid IDs citing it in `evidence_sources`. The reverse of
   * `bidToSource`, mirroring `opportunityToSource` and `noticeToSource`.
   */
  sourceToBid: Record<string, string[]>

  /**
   * Contract ID -> the single Notice it arose from, from `Contract.notice`.
   * Phase 1 section 6 field 2: N:1, required. Required even for a non-competitive
   * award, so a Contract is never an orphan with no procurement behind it.
   */
  contractToNotice: Record<string, string>
  /**
   * Contract ID -> the single Company it was awarded to, from `Contract.company`.
   * Phase 1 section 7.2: N:1, required.
   */
  contractToCompany: Record<string, string>
  /**
   * Contract ID -> the Bid it came from, from `Contract.bid`. Phase 1 section
   * 7.2: N:0..1 — a single-source or negotiated award has NO Bid, so an empty
   * string is a legitimate resolved state here and not a missing link. Every
   * other relationship index in this file is either N:1-required or N:N; this is
   * the single place where "no parent" is a recorded fact.
   */
  contractToBid: Record<string, string>

  /**
   * Bid ID -> Contract IDs it produced. The reverse of `contractToBid`, and the
   * index behind Phase 1 section 7.1's corrected cardinality: ONE BID MANY
   * CONTRACTS (1:0..N), because one award can yield a contract per awarded lot
   * or a framework with multiple orders. A one-to-one index could not represent
   * a multi-lot award at all, which is why Phase 1 corrected 0..1 to 0..N.
   * Pre-seeded with an empty list for every Bid, so "this bid has not been
   * contracted yet" is `[]` rather than a missing key.
   */
  bidToContract: Record<string, string[]>
  /**
   * Notice ID -> Contract IDs generated from it. The reverse of
   * `contractToNotice` (Phase 1: Notice 1:N Contract, "generates").
   */
  noticeToContract: Record<string, string[]>
  /**
   * Company ID -> Contract IDs awarded to it. The reverse of
   * `contractToCompany`, and the index behind "what are we actually under
   * contract to deliver?" for one company.
   */
  companyToContract: Record<string, string[]>
  /**
   * Procurement Match ID -> the single Notice it pairs, from
   * `ProcurementMatch.notice`. Phase P: N:1, required — the counterpart of
   * `matchToOpportunity` on the funding side, with no link to Opportunity.
   */
  procurementMatchToNotice: Record<string, string>
  /**
   * Procurement Match ID -> the single Company it pairs, from
   * `ProcurementMatch.company`. Phase P: N:1, required.
   */
  procurementMatchToCompany: Record<string, string>
}

/** The generated snapshot written to `src/data/generated/`. */
export interface VaultSnapshot {
  /** Bumped by hand when the shape changes. No timestamp, so output is stable. */
  schemaVersion: string
  generator: string
  source: {
    vaultDirectoryName: string
    contentFileCount: number
    recordCount: number
    totalSchemaFields: number
  }
  records: {
    opportunities: ImportedRecord<Opportunity>[]
    companies: ImportedRecord<Company>[]
    matches: ImportedRecord<Match>[]
    applications: ImportedRecord<Application>[]
    organizations: ImportedRecord<Organization>[]
    sources: ImportedRecord<Source>[]
    notices: ImportedRecord<Notice>[]
    bids: ImportedRecord<Bid>[]
    contracts: ImportedRecord<Contract>[]
    procurement_matches: ImportedRecord<ProcurementMatch>[]
  }
  relationships: Relationships
  unresolvedLinks: UnresolvedLink[]
}
