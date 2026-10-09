/**
 * Fictional / demonstration record classification.
 *
 * The vault contains 14 real records and 24 fictional demonstration records
 * (Phase 3 added three synthetic Notices, Phase 4 four synthetic Bids, and
 * Phase 6 one more Bid plus five Contracts, to the 11 pre-existing ones).
 * Getting this wrong in either direction is harmful, so the rules are narrow
 * and every decision records which rule fired.
 *
 * A record is fictional only if an AUTHORED MARKER matches. A free-text
 * mention is never enough.
 *
 * MARKER RULES (authored intent):
 *   filename-marker   The source filename contains a standalone `DEMO` or
 *                     `FICTIONAL` token.
 *   name-field-marker The record's own name field contains that token.
 *                     Only the five name fields the registry declares:
 *                     opportunity_name, company_name, organization_name,
 *                     source_name, notice_name. `match` and `application`
 *                     have no name field, so this rule cannot fire on them.
 *   body-banner       The body contains the authored banner
 *                     `FICTIONAL DEMONSTRATION`.
 *   demo-link         A frontmatter link points at a record already
 *                     classified fictional by the rules above. This is how
 *                     Match and Application records are caught: none of them
 *                     carry a filename or name-field token, and they have no
 *                     name field at all.
 *
 * EXPLICITLY NOT A MARKER:
 *   Any other field's free text. This matters: ORG-001 through ORG-004 are
 *   REAL, but their `contact_information` says things like "Not recorded in
 *   this demonstration record." A substring scan over all fields flagged all
 *   four as fictional, which is wrong. Only the name fields above are scanned.
 *
 * Ordering: the three authored rules are evaluated first, then `demo-link` is
 * applied to the records that are still undecided. This is a fixed-point-free
 * two-pass approach, so a link can never create a cycle.
 */

import { basename } from 'node:path'
import type { FictionalEvidence } from '../types/records'
import { NAME_FIELDS } from '../types/registry'
import type { RecordType } from '../types/registry'

/** Standalone token, so words like "demonstrate" do not match. */
const TOKEN = /(^|[^A-Za-z])(DEMO|FICTIONAL)([^A-Za-z]|$)/i

/** The authored banner, checked in the body only. */
const BODY_BANNER = 'FICTIONAL DEMONSTRATION'

// NAME_FIELDS comes from the registry: the fields whose text is an authored
// name marker. It is empty for Match and Application, which have no name field,
// and that is why those types can only be caught by the `demo-link` rule.

export interface ClassifyInput {
  id: string
  type: RecordType
  sourceFile: string
  frontmatter: Record<string, unknown>
  body: string
  /** Resolved frontmatter link targets, used for the `demo-link` rule. */
  linkedIds: string[]
}

export interface ClassifyResult extends FictionalEvidence {
  /** True when no authored marker applied and the record is treated as real. */
  decidedByDefault: boolean
}

/** Pass 1: authored markers only. */
export function classifyByMarkers(rec: ClassifyInput): ClassifyResult {
  const rules: string[] = []

  const base = basename(rec.sourceFile)
  if (TOKEN.test(base)) rules.push('filename-marker')

  for (const field of NAME_FIELDS[rec.type]) {
    const v = rec.frontmatter[field]
    if (typeof v === 'string' && TOKEN.test(v)) {
      rules.push(`name-field-marker:${field}`)
    }
  }

  if (rec.body.includes(BODY_BANNER)) rules.push('body-banner')

  const isFictional = rules.length > 0
  return {
    isFictional,
    rules,
    ambiguous: false,
    decidedByDefault: !isFictional,
    note: isFictional
      ? `Fictional by authored marker(s): ${rules.join(', ')}.`
      : 'No authored fictional marker. Treated as real unless a confirmed link says otherwise.',
  }
}

/**
 * Pass 2: apply `demo-link` to anything still undecided.
 * `fictionalIds` is the set decided by pass 1.
 */
export function applyLinkRule(
  rec: ClassifyInput,
  decided: ClassifyResult,
  fictionalIds: Set<string>,
): ClassifyResult {
  if (decided.isFictional) return decided

  const linked = rec.linkedIds.filter((id) => fictionalIds.has(id))
  if (linked.length > 0) {
    return {
      isFictional: true,
      rules: [...decided.rules, 'demo-link'],
      ambiguous: false,
      decidedByDefault: false,
      note:
        `Fictional by confirmed link to fictional record(s): ${linked.join(', ')}. ` +
        'Frontmatter link is to a record carrying an authored marker.',
    }
  }
  return decided
}

/** Records with a single resolved link are flagged so ambiguity is visible. */
export function checkAmbiguity(
  rec: ClassifyInput,
  decided: ClassifyResult,
): ClassifyResult {
  // Any record whose classification would flip if one link were rewritten is
  // worth surfacing. The link rule is exact, so this is a review aid.
  const linkedFictional = rec.linkedIds.length > 0
  if (linkedFictional && !decided.isFictional) {
    return {
      ...decided,
      note:
        decided.note +
        ' Links to records exist but none are fictional, so classified real.',
    }
  }
  return decided
}
