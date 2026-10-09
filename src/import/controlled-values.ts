/**
 * Authoritative controlled values, transcribed from the Data Dictionary's
 * "Controlled values" section (`08 - Documentation/Data Dictionary.md`).
 *
 * Twenty-five fields, 135 values. Nothing here is invented, normalised, or
 * extended: every entry is copied exactly as written in the Data Dictionary,
 * including capitalisation and the em dash in `Eligible—verified`. The Data
 * Dictionary remains the source of truth; this file is the machine-readable form
 * of it.
 *
 * Phase 6 added the four Contract lifecycle vocabularies. `contract_basis` is
 * deliberately NOT a separate list: it is the Bid's basis vocabulary, declared
 * once and used by both record types, so the two cannot drift apart.
 *
 * A non-blank value on a controlled field that is not in its list is an import
 * error. A BLANK value (`""`) is always allowed, because the Data Dictionary
 * permits a controlled field to be deliberately empty when nothing is
 * established yet. Blank is never treated as a violation, and blank is never
 * filled in.
 *
 * Fields deliberately absent: `region`, `industry`, `company_stage`,
 * `beneficiary_type`, `benefit_type`, `currency`, `legal_entity_type`,
 * `revenue_range`, `application_method`, `organization_type`, `source_type`,
 * and the free-text person/document fields. The Data Dictionary lists
 * illustrative values for those and states they are not closed vocabularies,
 * so they are left free here.
 *
 * ---------------------------------------------------------------------------
 * NOTICE VOCABULARIES (added in Phase 3)
 * ---------------------------------------------------------------------------
 *
 * Seven Notice vocabularies are transcribed verbatim from the Phase 1
 * Finalization & Architecture Review, section 4 ("Corrected Notice Schema"),
 * which is the authoritative design for the type. They are NOT from the Data
 * Dictionary, which did not exist for Notice before this phase; the Data
 * Dictionary has been updated to match.
 *
 * `country`, `deadline_type`, and `verification_status` are REUSED unchanged
 * from the funding domain, as Phase 1 directs. Note `deadline_type`'s
 * `Recurring` value is inapplicable to a procurement notice; the vocabulary is
 * shared regardless, so the importer does not forbid a value that the Data
 * Dictionary permits.
 *
 * Two Notice fields that a reader might expect to be controlled are
 * deliberately free text, because Phase 1 section 9.2 marks both "Needs
 * research" and no procurement source exists anywhere in the project:
 *
 *   - `msme_or_small_business_preference`
 *   - `local_content_preference`
 *
 * Inventing a closed list for those would fabricate procurement rules. A blank
 * or a quoted sentence is the honest state.
 *
 * `issuing_platform` is the one vocabulary that is both listed in Phase 1
 * section 4 AND flagged "Needs research" in section 9.2. The Phase 1 list is
 * used verbatim because it is documented Phase 1 design rather than invention,
 * but it is unverified against any real portal. Flagged in the Phase 3 report.
 *
 * ---------------------------------------------------------------------------
 * CONTRACT VOCABULARIES (added in Phase 6)
 * ---------------------------------------------------------------------------
 *
 * Four new vocabularies are transcribed verbatim from the Phase 1 Finalization &
 * Architecture Review, section 6 ("Contract Schema"): `contract_status`,
 * `performance_security_status`, `acceptance_status`, and `payment_status`.
 *
 * A FIFTH Contract controlled field, `contract_basis`, is REUSED unchanged from
 * Bid rather than redeclared. Both types ask the identical question — why was
 * this awarded without competition? — and a second near-identical list would make
 * a reader choose between two answers to one question, which is precisely what
 * Phase 1 decision D8 rejected when it reused `eligibility_status`. Sharing the
 * list also makes the two records comparable without a translation step.
 *
 * The three currency fields on Contract (`contract_value_currency`,
 * `performance_guarantee_currency`, and the implicit currency of
 * `payment_received_to_date`) stay FREE TEXT, for the same reason Bid's three
 * currency fields do: Phase 1 section 9.2 reuses the vault's existing free-text
 * currency convention, marks every jurisdiction-specific value "Needs research",
 * and no procurement source exists in the project from which a closed list could
 * be derived. `contract_value_currency` is nevertheless REQUIRED, so a Contract
 * can never carry a bare number.
 *
 * `performance_guarantee_required` is a boolean, not a vocabulary. Phase 1 gives
 * it "Cannot be blank" rather than a value list, so the blank rule is enforced
 * through the field's kind and inventing a third security axis here would
 * duplicate `performance_security_status`.
 */

/* ---------------------------------------------------------------------------
 * BID VOCABULARIES (added in Phase 4)
 * ---------------------------------------------------------------------------
 *
 * Four new vocabularies are transcribed verbatim from the Phase 1 Finalization &
 * Architecture Review, section 5 ("Corrected Bid Schema"): `bid_decision`,
 * `bid_status`, `security_posted_status`, and `contract_basis`. A fifth Bid
 * controlled field, `eligibility_status`, is REUSED unchanged from the funding
 * domain on Phase 1's explicit instruction (section 8.2, decision D8): the
 * question it answers is identical, and a second near-identical status set would
 * make a reader choose between two vocabularies for one judgement.
 *
 * Note the count disagreement: section 11 (roadmap) describes "2 new controlled
 * vocabularies (10 + 4 values)", which predates the corrected field table. The
 * section 5 table is the authoritative field design and marks four new
 * controlled fields, worth 25 values. The table is followed, for the same reason
 * Phase 3 followed the section 4 table rather than roadmap prose.
 *
 * The three currency fields on Bid (`quoted_currency`, `security_posted_currency`,
 * `awarded_currency`) stay FREE TEXT. Phase 1 section 9.2 states the vault reuses
 * its existing free-text currency convention and never sums across currencies; it
 * also marks every jurisdiction-specific value "Needs research". There is no
 * procurement source anywhere in the project from which a closed currency list
 * could be derived, and inventing one would fabricate a rule.
 */

/** Allowed values for a controlled field. Order matches the Data Dictionary. */
export const CONTROLLED_VALUES: Record<string, readonly string[]> = {
  opportunity_type: ['Grant', 'Fund', 'Subsidy', 'Incentive', 'Program'],
  // Phase 1 shipped India and USA. The controlled-writer phases add the
  // countries actually observed from the sanctioned live source (TED reports
  // ISO 3166-1 alpha-3, normalised to full names): the writer refuses any
  // country outside this list, so a discovered Polish or Portuguese notice
  // could not otherwise be filed at all. Values are never invented — only
  // source-observed ones are added.
  country: ['India', 'USA', 'Poland', 'Romania', 'Latvia', 'France', 'Portugal'],
  deadline_type: ['Fixed', 'Rolling', 'Recurring', 'Unknown'],
  verification_status: ['Unverified', 'Verified', 'Needs review'],
  record_status: ['Upcoming', 'Active', 'Closed', 'Archived'],
  profile_status: ['Draft', 'Needs review', 'Verified', 'Archived'],
  match_status: ['New', 'Under review', 'Matched', 'Not a match', 'Needs information'],
  eligibility_status: [
    'Not assessed',
    'Potentially eligible',
    'Eligible—verified',
    'Ineligible',
    'Needs more information',
  ],
  application_status: [
    'Researching',
    'Preparing',
    'Submitted',
    'Under review',
    'Awarded',
    'Rejected',
    'Withdrawn',
    'On hold',
  ],
  priority: ['Low', 'Medium', 'High', 'Critical'],

  /* ---- Notice (Phase 1 Finalization, section 4) ---- */
  notice_type: ['RFB', 'RFQ', 'RFP', 'RTE', 'EOI', 'Tender', 'Single source', 'Other'],
  procurement_method: [
    'Open',
    'Limited',
    'Single source',
    'E-auction',
    'Direct purchase',
    'GeM direct',
    'Other',
  ],
  issuing_platform: [
    'GeM',
    'CPPP',
    'eProcure',
    'SAM.gov',
    'State portal',
    'Offline',
    'Aggregator',
    'Other',
  ],
  // Two real lot shapes. Phase 1 removed the third value "No lots": a notice
  // with no lots is simply single-lot. The controlled-writer phase adds
  // "Unknown" because the field is required and the discovery pipeline carries
  // no lot fact whatsoever — "Unknown" records that absence explicitly instead
  // of leaving the required field blank or inventing a shape.
  lot_structure: ['Single lot', 'Multi lot', 'Unknown'],
  // The controlled 3-way classification. `category` is the buyer's own
  // sub-taxonomy and stays a free-text LIST: Phase 1 section 2.4 found the two
  // overlapped and redefined `category` to remove the overlap. "Unknown" is
  // added by the controlled-writer phase for the same honesty reason as
  // lot_structure: the field is required, discovery carries no contract-nature
  // fact, and an explicit absence beats a blank or a guess.
  contract_type: ['Goods', 'Services', 'Works', 'Mixed', 'Unknown'],
  evaluation_method: [
    'Lowest price',
    'Lowest evaluated price',
    'Combined technical and price',
    'Quality and cost based',
    'Single bid',
    'Not stated',
  ],
  notice_status: [
    'Draft',
    'Published',
    'Open',
    'Closed',
    'Under evaluation',
    'Awarded',
    'Cancelled',
    'Archived',
  ],

  /* ---- Bid (Phase 1 Finalization, section 5) ---- */
  // Axis 2 — the go/no-go decision. Reused by no other type, and `No bid` is a
  // first-class outcome rather than an omission: Phase 1 section 5 calls the
  // rationale "the record's durable institutional value".
  bid_decision: ['Pending', 'Bid', 'No bid', 'Deferred'],
  // Axis 3 — where the bid physically stands. `Opened` is kept although Phase 1
  // section 8.4 marks it an open decision, on the stated grounds that it is
  // harmless if unused and honest when a sealed tender does use it.
  bid_status: [
    'Researching',
    'Preparing',
    'Submitted',
    'Opened',
    'Under evaluation',
    'Clarification',
    'Awarded',
    'Not awarded',
    'Withdrawn',
    'Cancelled',
    'On hold',
  ],
  // What one company actually posted. Distinct from Notice's `bid_security_*`,
  // which is what the BUYER DEMANDS from any bidder (Phase 1 section 5 renames
  // the Bid side to `security_posted_*` specifically to stop the collision).
  security_posted_status: [
    'Not required',
    'Not submitted',
    'Submitted',
    'Released',
    'Forfeited',
  ],
  // Why an award happened without a competing bid. Only meaningful when there was
  // no competition, so it is left blank on a genuinely competitive award.
  contract_basis: [
    'Awarded after competitive bid',
    'Single source',
    'Negotiated',
    'Letter of intent',
    'Direct award',
  ],

  /* ---- Contract (Phase 1 Finalization, section 6) ---- */
  // Three INDEPENDENT axes of a post-award instrument, deliberately not merged
  // into one "status". Phase 1 section 6 gives each its own column, because they
  // answer different questions and move on different clocks: what the buyer
  // requires of our security, whether the delivered work has been accepted, and
  // whether we have been paid. This is the same separation-of-axes principle
  // Phase 4 applied to Bid's eligibility/decision/lifecycle, and for the same
  // reason: a single status column would force a reader to guess which of the
  // three a value referred to.
  performance_security_status: [
    'Not required',
    'Not submitted',
    'Submitted',
    'Released',
    'Forfeited',
    'Claimed',
  ],
  acceptance_status: [
    'Not applicable',
    'Pending',
    'Under inspection',
    'Accepted',
    'Rejected',
  ],
  payment_status: ['Not started', 'Partially paid', 'Fully paid', 'Withheld', 'Disputed'],
  // Section 8.6 fixes the lifecycle shape:
  //   Awarded -> Active -> Delivered -> Accepted -> Completed
  //                +-> Under dispute -> Active | Terminated
  //                +-> Terminated
  // `Awarded` and `Active` are the same instant from two viewpoints: the award
  // is recorded, and the obligations have begun. `Completed` is distinct from
  // `Accepted` because acceptance closes delivery while completion closes the
  // contract's own term (retention release, warranty handover).
  contract_status: [
    'Awarded',
    'Active',
    'Delivered',
    'Accepted',
    'Under dispute',
    'Terminated',
    'Completed',
  ],
}

/**
 * The controlled field names, in table order. Funding fields first, then the
 * Notice vocabularies, then the Bid vocabularies.
 */
export const CONTROLLED_FIELDS: readonly string[] = Object.keys(CONTROLLED_VALUES)

/** Allowed values across every controlled field. */
export const TOTAL_CONTROLLED_VALUES = Object.values(CONTROLLED_VALUES).reduce(
  (n, values) => n + values.length,
  0,
)

/** Allowed values for a field, or undefined when the field is not controlled. */
export function allowedValuesFor(field: string): readonly string[] | undefined {
  return CONTROLLED_VALUES[field]
}

/**
 * Explain why a value is not allowed, or undefined when it is.
 * `context` is used in the message so the error names the record and field.
 */
export function controlledValueProblem(
  field: string,
  value: unknown,
  context: string,
): string | undefined {
  const allowed = CONTROLLED_VALUES[field]
  if (!allowed) return undefined
  if (value === '') return undefined
  if (typeof value !== 'string') {
    return `${context}.${field}: expected one of the controlled values, got ${typeof value}`
  }
  if (allowed.includes(value)) return undefined
  return (
    `${context}.${field}: ${JSON.stringify(value)} is not an allowed value. ` +
    `Allowed: ${allowed.join(' | ')}`
  )
}
