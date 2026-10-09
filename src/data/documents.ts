/**
 * Phase 7 — Bid document sets, derived from the two flat lists.
 *
 * Phase 1 section "Phase 7 — Bid Document Management" sets the acceptance
 * criterion: "A complete bid's document set is verifiable as a set, not as two
 * lists that may disagree." This module is the thing that makes that true. It
 * derives the set from the stored lists and never stores it back.
 *
 * ## Why there is still no Document record
 *
 * Phase 1 roadmap line: "Overall proposed architecture — three new record
 * types: Notice, Bid, Contract." There is no Document type, and "Attachment"
 * does not appear anywhere in the Phase 1 design. Founder decision D10
 * ("Document storage and confidentiality") recommends option (a), names only,
 * and rejects external storage because "the platform does not have" it. So
 * nothing here references a file, a path, a URL, a size, or a hash. A document
 * name is a string the vault records; the vault does not hold the document.
 *
 * D10 also flags bid documents as commercially sensitive. That is why no
 * derived value here is ever exported, shared, or sent anywhere. Everything is
 * local, read-only, and computed from data already in the snapshot.
 *
 * ## Why this is a set and not two lists
 *
 * Phase 1 rule 11 makes `completed_documents` a subset of `required_documents`,
 * which the importer already enforces. That rule stops an orphan completion but
 * it does not make the lists a set, for two reasons it does not cover:
 *
 * 1. A repeated entry is invisible to a subset check. `required = [A, A, B]`
 *    with `completed = [A, B]` satisfies rule 11 and still reports two
 *    outstanding items against one real document. The arithmetic here
 *    deduplicates before counting, so the count reflects distinct names.
 * 2. A blank entry satisfies rule 11 without asserting anything.
 *    `required = ['', 'A']` is a valid subset of itself and claims a document
 *    that does not exist.
 *
 * Both are rejected at import (see the gates in `import/validate.ts`) so they
 * cannot reach the UI from the vault. They are still computed here rather than
 * assumed away, because the UI must not silently render a blank line as a real
 * document if a snapshot ever contains one.
 *
 * ## What this module deliberately does not produce
 *
 * No percentage, no ratio, no "80% complete", no score, and no ranking. Phase 7
 * is not a compliance measurement and the data cannot support one: a document
 * name carries no weight, no importance, and no deadline. Completeness is
 * reported as "n of m" counts, which is the whole of what the lists say.
 */

import { listField, noticeForBid } from './selectors'
import type { RecordRow } from '../types/records'

/* ------------------------------------------------------------------ */
/* Entry hygiene                                                        */
/* ------------------------------------------------------------------ */

/**
 * Names as distinct values, keeping first-occurrence order.
 *
 * Order is preserved rather than sorted so the displayed sequence matches the
 * sequence in the record file. A reader comparing the page against the Markdown
 * should not have to re-sort in their head.
 *
 * Comparison is exact string equality, which is what importer rule 11 uses
 * (`required.includes(d)`). Normalising here — trimming, or folding case —
 * would make this module disagree with the gate that admitted the record: the
 * page would report a document as matched that the validator considered a
 * mismatch. Exactness is the only choice that keeps one definition of equality
 * in the codebase.
 */
function distinct(entries: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const e of entries) {
    if (seen.has(e)) continue
    seen.add(e)
    out.push(e)
  }
  return out
}

/** Entries that are empty or whitespace only. A name of these asserts nothing. */
function blanksIn(entries: readonly string[]): string[] {
  return distinct(entries.filter((e) => e.trim() === ''))
}

/** Entries appearing more than once, in first-occurrence order. */
function repeatedIn(entries: readonly string[]): string[] {
  const counts = new Map<string, number>()
  for (const e of entries) counts.set(e, (counts.get(e) ?? 0) + 1)
  return distinct(entries.filter((e) => (counts.get(e) ?? 0) > 1))
}

/* ------------------------------------------------------------------ */
/* The Bid document set                                                 */
/* ------------------------------------------------------------------ */

/**
 * Four states, because three of the four are real and collapsing any two of
 * them would assert something the record does not say.
 *
 * - `not_recorded` — `required_documents` is absent. The record is silent, and
 *   silence is not the same as "nothing outstanding".
 * - `none_required` — the key is present and empty. The list positively
 *   requires nothing.
 * - `incomplete`  — at least one required name has no completion.
 * - `complete`     — every required name appears in `completed_documents`.
 */
export type DocumentSetStatus = 'not_recorded' | 'none_required' | 'incomplete' | 'complete'

export const DOCUMENT_SET_STATUS_LABEL: Record<DocumentSetStatus, string> = {
  not_recorded: 'Not recorded',
  none_required: 'No documents required',
  incomplete: 'Incomplete',
  complete: 'Complete',
}

/** Plain-language explanation of what each status does and does not mean. */
export const DOCUMENT_SET_STATUS_NOTE: Record<DocumentSetStatus, string> = {
  not_recorded:
    'This bid records no required_documents list, so there is nothing to check against. An unrecorded list is not an empty one.',
  none_required:
    'The required_documents list is present and empty, so no document is outstanding by this bid’s own account.',
  incomplete:
    'Every required document must also appear in completed_documents. The names below are required and not yet recorded as completed.',
  complete:
    'Every name in required_documents appears in completed_documents. This describes the two recorded lists only — it is not a statement about what has been filed with the buyer, and the vault holds no document files.',
}

/** One Bid's document set, derived. Nothing here is stored. */
export interface DocumentSet {
  status: DocumentSetStatus
  /** Distinct required names, in recorded order. */
  required: string[]
  /** Distinct completed names, in recorded order. */
  completed: string[]
  /** Distinct required names with no completion, in required order. */
  missing: string[]
  /** Distinct counts. Never combined into a percentage. */
  requiredCount: number
  completedCount: number
  missingCount: number
  /** True only for `complete`. */
  isComplete: boolean
  /** Blank or whitespace-only names, which the importer rejects. */
  blanks: string[]
  /** Names recorded more than once, which the importer rejects. */
  duplicates: string[]
  /** False when `required_documents` is absent rather than empty. */
  isRecorded: boolean
}

/**
 * Derive one Bid's document set.
 *
 * `missing` is the set difference `required \ completed`, computed against the
 * deduplicated `completed` list so a name repeated on both sides still counts
 * once. It is deliberately not `required.filter(...)` on raw arrays: that would
 * report a repeated required name as outstanding twice.
 */
export function documentSetFor(bid: RecordRow): DocumentSet {
  const rawRequired = listField(bid, 'required_documents')
  const rawCompleted = listField(bid, 'completed_documents')

  const required = distinct(rawRequired ?? [])
  const completed = distinct(rawCompleted ?? [])
  const completedLookup = new Set(completed)
  const missing = required.filter((name) => !completedLookup.has(name))

  const isRecorded = rawRequired !== undefined

  let status: DocumentSetStatus
  if (!isRecorded) {
    status = 'not_recorded'
  } else if (required.length === 0) {
    status = 'none_required'
  } else if (missing.length > 0) {
    status = 'incomplete'
  } else {
    status = 'complete'
  }

  return {
    status,
    required,
    completed,
    missing,
    requiredCount: required.length,
    completedCount: completed.length,
    missingCount: missing.length,
    isComplete: status === 'complete',
    blanks: distinct([...blanksIn(rawRequired ?? []), ...blanksIn(rawCompleted ?? [])]),
    duplicates: distinct([
      ...repeatedIn(rawRequired ?? []),
      ...repeatedIn(rawCompleted ?? []),
    ]),
    isRecorded,
  }
}

/* ------------------------------------------------------------------ */
/* Notice mandatory documents                                           */
/* ------------------------------------------------------------------ */

/**
 * A Notice's `mandatory_bid_documents`: what the buyer demands from every
 * bidder.
 *
 * This is a different field from `Bid.required_documents` and the two were
 * renamed apart in Phase 1 section 2.2 precisely because they collide. The
 * Notice list belongs to the buyer and is identical for all bidders; the Bid
 * list belongs to one company and may add its own certificates. Neither is a
 * completion record, and neither may be read as one.
 */
export function mandatoryDocumentsFor(notice: RecordRow): string[] {
  return distinct(listField(notice, 'mandatory_bid_documents') ?? [])
}

/* ------------------------------------------------------------------ */
/* The relationship between the two lists                               */
/* ------------------------------------------------------------------ */

/**
 * How much of the parent Notice's mandate this Bid's own list names.
 *
 * This is an OBSERVATION, never a gate and never a pass/fail. Phase 1
 * establishes no containment rule between the two fields, and the shipped
 * records show why one would be wrong: `BID-005` covers two of `RFB-002`'s
 * three lots and names one document the notice does not mandate, which is
 * legitimate for a partial award. Asserting `required ⊇ mandatory` would
 * reject a valid record.
 *
 * So this reports the overlap and lets a reader judge it. The field is named
 * `notNamedInBid` rather than `missing` throughout, because "missing" would
 * assert the bid failed to include something the buyer required — a claim about
 * compliance that these two lists cannot support.
 */
export interface MandatoryCoverage {
  /** The Notice this Bid answers, or null when no notice is recorded. */
  noticeId: string | null
  /** Distinct mandatory names from the Notice, in recorded order. */
  mandatory: string[]
  /** Mandatory names that appear in this Bid's `required_documents`. */
  namedInBid: string[]
  /** Mandatory names absent from this Bid's `required_documents`. */
  notNamedInBid: string[]
}

/**
 * Compute the overlap between a Bid's required list and its Notice's mandate.
 *
 * A Bid with no recorded Notice yields `noticeId: null` and empty lists rather
 * than a throw, so a caller can render the observation unconditionally. In the
 * shipped corpus every Bid names a Notice, but the schema treats that link as
 * data, and this function does not assume what the data says.
 */
export function mandatoryCoverageFor(bid: RecordRow): MandatoryCoverage {
  const notice = noticeForBid(bid.id)
  if (!notice) {
    return { noticeId: null, mandatory: [], namedInBid: [], notNamedInBid: [] }
  }
  const mandatory = mandatoryDocumentsFor(notice)
  const requiredLookup = new Set(distinct(listField(bid, 'required_documents') ?? []))
  return {
    noticeId: notice.id,
    mandatory,
    namedInBid: mandatory.filter((name) => requiredLookup.has(name)),
    notNamedInBid: mandatory.filter((name) => !requiredLookup.has(name)),
  }
}

/* ------------------------------------------------------------------ */
/* Corpus-level counts                                                  */
/* ------------------------------------------------------------------ */

/**
 * Bid document-set totals, for reporting only.
 *
 * Reported as counts because that is all the lists support. There is
 * deliberately no aggregate completion figure: with five demonstration bids,
 * any single number would describe the demonstration rather than any business,
 * and the value would change the moment a record was edited.
 */
export interface DocumentSetTotals {
  totalBids: number
  withRequiredList: number
  withoutRequiredList: number
  complete: number
  incomplete: number
  noneRequired: number
  /** Distinct outstanding names summed across Bids. */
  outstanding: number
}

/** Totals across every Bid in the snapshot. */
export function documentSetTotals(bids: readonly RecordRow[]): DocumentSetTotals {
  const sets = bids.map(documentSetFor)
  return {
    totalBids: sets.length,
    withRequiredList: sets.filter((s) => s.status !== 'not_recorded').length,
    withoutRequiredList: sets.filter((s) => s.status === 'not_recorded').length,
    complete: sets.filter((s) => s.status === 'complete').length,
    incomplete: sets.filter((s) => s.status === 'incomplete').length,
    noneRequired: sets.filter((s) => s.status === 'none_required').length,
    outstanding: sets.reduce((sum, s) => sum + s.missingCount, 0),
  }
}