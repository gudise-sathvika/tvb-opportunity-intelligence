/**
 * Procurement metrics and views.
 *
 * Every function here is a pure, deterministic read over the imported snapshot.
 * Nothing is estimated, weighted, scored, or inferred. There is no win rate, no
 * conversion rate, no pipeline health figure, and no attractiveness score,
 * because the snapshot cannot support any of them honestly:
 *
 *   - A win rate needs the bids we LOST to as well as the ones we won. The
 *     vault records only our own bids, so the denominator does not exist.
 *   - A value total needs currency grouping (Phase 1 rule 12). Three currencies
 *     appear across the corpus and one award value exists; a sum would be
 *     meaningless even where it is arithmetically possible.
 *   - A "health" or "quality" score has no defined method anywhere in the vault.
 *     Phase 1 risk O5 explicitly refuses a `match_score` equivalent for
 *     procurement, and inventing one here would contradict an approved decision.
 *
 * TWO DESIGN RULES worth stating, because both were gotten wrong first:
 *
 * 1. TIME IS A PARAMETER, NOT A HIDDEN GLOBAL. Every function that needs "now"
 *    takes `today` as an explicit `YYYY-MM-DD` argument. A metric that reads the
 *    system clock internally is untestable and silently changes its answer
 *    overnight. Callers pass `todayISO()`; tests pass a fixed date.
 *
 * 2. A BLANK DATE IS NOT A DUE DATE. `bid_submission_deadline: ''` is a recorded
 *    unknown, and it classifies as `none_recorded` — never as `past`, and never
 *    as `upcoming`. Treating blank as overdue would manufacture false alarms on
 *    exactly the records whose author was honest about not knowing.
 *
 * The three Bid axes are never combined into one figure anywhere in this module.
 * Eligibility, decision, and lifecycle answer three different questions, and a
 * single blended number would hide whichever is unresolved.
 */

import { CONTROLLED_VALUES } from '../import/controlled-values'
import {
  bidForContract,
  bidsForCompany,
  bidsForNotice,
  companyForBid,
  companyForContract,
  listBids,
  listCompanies,
  listContracts,
  listNotices,
  noticeForBid,
  noticeForContract,
  procuringEntityForNotice,
  field,
  sourcesForBid,
  textField,
} from './selectors'
import type { RecordRow } from '../types/records'

/* ------------------------------------------------------------------ */
/* Time                                                                */
/* ------------------------------------------------------------------ */

/**
 * Today's date as `YYYY-MM-DD` in the viewer's own calendar.
 *
 * The vault's dates are date-only strings with no timezone, so comparing them
 * against a local calendar date is the only non-arbitrary comparison available.
 * No time-of-day is involved anywhere, which is why no timezone conversion
 * happens: there is nothing to convert.
 */
export function todayISO(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** True for a syntactically valid `YYYY-MM-DD` string. */
export function isISODate(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const [y, m, d] = v.split('-').map(Number)
  if (m < 1 || m > 12 || d < 1 || d > 31) return false
  const probe = new Date(Date.UTC(y, m - 1, d))
  // Rejects 2026-02-30 and friends, which Date.UTC would silently roll over.
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d
}

/* ------------------------------------------------------------------ */
/* Deadline classification                                              */
/* ------------------------------------------------------------------ */

/**
 * The three states a recorded date can be in.
 *
 * `none_recorded` is a first-class outcome, not an error case. Two of the three
 * Notice records are affected: one deadline is blank, and the schema permits it.
 */
export type DeadlineState = 'upcoming' | 'past' | 'none_recorded'

export const DEADLINE_STATE_LABEL: Record<DeadlineState, string> = {
  upcoming: 'Upcoming',
  past: 'Past',
  none_recorded: 'No deadline recorded',
}

/**
 * Classify one date-only value against a reference date.
 *
 * - A blank, absent, or malformed value is `none_recorded`.
 * - A date equal to `today` is `upcoming`, not `past`. A deadline that falls at
 *   the end of the current day has not yet passed, and using `<` on the
 *   reference date would report it overdue for up to 24 hours.
 *
 * There is deliberately no "due soon" bucket. It would require an arbitrary
 * look-ahead window that no record in the vault states, and inventing one is
 * exactly the kind of unsupported threshold this phase forbids. See the
 * "Deliberately not implemented" note in the dashboard.
 */
export function classifyDeadline(value: unknown, today: string): DeadlineState {
  if (!isISODate(value)) return 'none_recorded'
  return value < today ? 'past' : 'upcoming'
}

/** The Notice's own submission deadline, classified. */
export function noticeDeadlineState(notice: RecordRow, today: string): DeadlineState {
  return classifyDeadline(textField(notice, 'bid_submission_deadline'), today)
}

/**
 * A Bid inherits its deadline from the Notice it pursues.
 *
 * A Bid record has no deadline field of its own, so this resolves the parent
 * Notice rather than duplicating the date. A Bid whose Notice is missing, or
 * whose Notice has a blank deadline, is `none_recorded` — the same honest
 * answer, arrived at by a different route.
 */
export function bidDeadlineState(bid: RecordRow, today: string): DeadlineState {
  const notice = noticeForBid(bid.id)
  return notice ? noticeDeadlineState(notice, today) : 'none_recorded'
}

/** Notices bucketed by deadline state. */
export function noticesByDeadline(today: string): Record<DeadlineState, RecordRow[]> {
  const out: Record<DeadlineState, RecordRow[]> = { upcoming: [], past: [], none_recorded: [] }
  for (const n of listNotices()) out[noticeDeadlineState(n, today)].push(n)
  return out
}

/**
 * Deadline counts across both procurement types, as plain counts.
 *
 * Notices use their own `bid_submission_deadline`; Bids inherit the deadline of
 * the Notice they pursue, because a Bid record has no deadline field. The two
 * counts are reported separately rather than added together — they count
 * different things, and a combined total would double-count every tender that
 * has at least one bid.
 */
export function deadlineStates(today: string): {
  notices: Record<DeadlineState, number>
  bids: Record<DeadlineState, number>
} {
  const notices: Record<DeadlineState, number> = { upcoming: 0, past: 0, none_recorded: 0 }
  const bids: Record<DeadlineState, number> = { upcoming: 0, past: 0, none_recorded: 0 }
  for (const n of listNotices()) notices[noticeDeadlineState(n, today)] += 1
  for (const b of listBids()) bids[bidDeadlineState(b, today)] += 1
  return { notices, bids }
}

/* ------------------------------------------------------------------ */
/* Counts                                                              */
/* ------------------------------------------------------------------ */

/** Notices that at least one Bid names. */
export function noticesWithBids(): RecordRow[] {
  return listNotices().filter((n) => bidsForNotice(n.id).length > 0)
}

/**
 * Notices no Bid names.
 *
 * Currently empty: all three demo Notices have at least one Bid. That is the
 * correct state of this corpus, and the empty case is written down rather than
 * assumed away, because "no bids" is the operationally interesting case and it
 * will not stay empty.
 */
export function noticesWithoutBids(): RecordRow[] {
  return listNotices().filter((n) => bidsForNotice(n.id).length === 0)
}

/** Bid count per Notice, keyed by Notice ID. Every Notice gets an entry. */
export function bidCountByNotice(): Record<string, number> {
  const out: Record<string, number> = {}
  for (const n of listNotices()) out[n.id] = bidsForNotice(n.id).length
  return out
}

/** Companies with at least one Bid, and the subset with more than one. */
export function companyProcurement(): {
  withBids: number
  multipleBids: number
  total: number
} {
  let multipleBids = 0
  let withBids = 0
  for (const c of listCompanies()) {
    const n = bidsForCompany(c.id).length
    if (n > 0) withBids += 1
    if (n > 1) multipleBids += 1
  }
  return { withBids, multipleBids, total: listCompanies().length }
}

/* ------------------------------------------------------------------ */
/* Grouping by the three axes                                          */
/* ------------------------------------------------------------------ */

export interface AxisGroup {
  /** The controlled value, verbatim. Never re-bucketed or renamed. */
  value: string
  count: number
  ids: string[]
}

/**
 * Group Bids by one of the three status axes.
 *
 * Every value in the field's controlled vocabulary is returned, including those
 * with a count of zero. A zero here is a true statement — the vocabulary defines
 * the state and no Bid is in it — and showing the whole vocabulary is what makes
 * the distribution legible. Only the axis named is grouped; the other two are
 * untouched, so a reader can always see the full three-axis picture.
 */
export function bidsByAxis(bids: RecordRow[], axis: 'eligibility_status' | 'bid_decision' | 'bid_status'): AxisGroup[] {
  const vocab = CONTROLLED_VALUES[axis] ?? []
  const groups = new Map<string, string[]>(vocab.map((v) => [v, []]))
  for (const b of bids) {
    const v = textField(b, axis)
    if (typeof v !== 'string' || v === '') continue
    if (!groups.has(v)) groups.set(v, [])
    groups.get(v)!.push(b.id)
  }
  return [...groups.entries()].map(([value, ids]) => ({ value, count: ids.length, ids }))
}

/** Group Notices by any of its controlled fields, zeros included. */
export function noticesByField(fieldName: string): AxisGroup[] {
  const vocab = CONTROLLED_VALUES[fieldName] ?? []
  const groups = new Map<string, string[]>(vocab.map((v) => [v, []]))
  for (const n of listNotices()) {
    const v = textField(n, fieldName)
    if (typeof v !== 'string' || v === '') continue
    if (!groups.has(v)) groups.set(v, [])
    groups.get(v)!.push(n.id)
  }
  return [...groups.entries()].map(([value, ids]) => ({ value, count: ids.length, ids }))
}

/**
 * The declared `bid_status` vocabulary, in the order the schema declares it.
 *
 * Read from `CONTROLLED_VALUES` rather than hardcoded, so the schema stays the
 * single source of truth. Whether that order is a meaningful progression is a
 * judgement recorded in the dashboard's own copy, not something this function
 * asserts.
 */
export const BID_STATUS_ORDER: string[] = [...(CONTROLLED_VALUES.bid_status ?? [])]

/**
 * `bid_status` values that represent a finished pursuit.
 *
 * Used only to decide whether a stale `next_action_date` is worth flagging:
 * re-prompting someone about a bid that was already awarded or withdrawn is
 * noise. Taken from the vocabulary, not invented.
 */
/**
 * Phase 1 section 8.6 lifecycle order for Contract.
 *
 * Taken from the controlled vocabulary's own order rather than restated, so the
 * two cannot drift: the vocabulary is transcribed verbatim from the Phase 1 table
 * and is already in lifecycle order. `Under dispute` and `Terminated` sit after
 * `Active` because both are reachable from `Active` and from nowhere else.
 */
export const CONTRACT_STATUS_ORDER: readonly string[] = [
  ...(CONTROLLED_VALUES.contract_status ?? []),
]

/**
 * Read a numeric field without treating a blank as zero.
 *
 * Returns undefined for both a blank string and an absent field. The distinction
 * matters in `sortContracts`: a missing amount must sort last, not first, which is
 * what treating it as 0 would do. `Number('')` is 0 and `Number(null)` is 0 too,
 * so neither can be passed through unguarded.
 */
function numberField(rec: RecordRow, name: string): number | undefined {
  const raw = field(rec, name)
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw)
    if (Number.isFinite(n)) return n
  }
  return undefined
}

export const TERMINAL_BID_STATUSES: readonly string[] = [
  'Awarded',
  'Not awarded',
  'Withdrawn',
  'Cancelled',
]

/** True when the Bid's lifecycle has reached a terminal value. */
export function isTerminalBid(bid: RecordRow): boolean {
  return TERMINAL_BID_STATUSES.includes(textField(bid, 'bid_status') ?? '')
}

/* ------------------------------------------------------------------ */
/* Evidence                                                            */
/* ------------------------------------------------------------------ */

/**
 * Evidence coverage, as counts only.
 *
 * Returned as "n of m" pairs rather than a percentage, because a percentage
 * invites the reading "80% verified", which this data cannot mean. What is
 * actually knowable is how many Bids cite at least one Source, and how many
 * claim `Eligible—verified` with nothing cited — and the second is the one that
 * matters, because it would be an unsupported claim.
 */
export function evidenceCoverage(): {
  totalBids: number
  withSource: number
  withoutSource: number
  verifiedClaims: number
  verifiedWithoutSource: number
} {
  const bids = listBids()
  let withSource = 0
  let verifiedClaims = 0
  let verifiedWithoutSource = 0
  for (const b of bids) {
    const cited = sourcesForBid(b.id).length > 0
    if (cited) withSource += 1
    const verified = textField(b, 'eligibility_status') === 'Eligible—verified'
    if (verified) {
      verifiedClaims += 1
      if (!cited) verifiedWithoutSource += 1
    }
  }
  return {
    totalBids: bids.length,
    withSource,
    withoutSource: bids.length - withSource,
    verifiedClaims,
    verifiedWithoutSource,
  }
}

/* ------------------------------------------------------------------ */
/* Attention                                                           */
/* ------------------------------------------------------------------ */

/**
 * A deterministic condition worth a human's attention.
 *
 * There is no severity, no priority score, and no ranking. Each item carries the
 * rule that produced it and a sentence explaining why it fired, so a reader can
 * disagree with the rule rather than having to trust a number. Items are sorted
 * by record ID so the list order is stable between renders.
 */
export interface AttentionItem {
  /** Stable machine name of the rule, for tests and for explaining the rule. */
  rule: string
  /** Plain-language reason, always stating the recorded values it compared. */
  reason: string
  recordId: string
  recordType: 'Notice' | 'Bid'
}

/**
 * Every attention item the current data supports.
 *
 * Each rule below needs only values the vault actually records. Nothing here
 * infers urgency from a field that is blank, and no rule ranks one item above
 * another.
 */
export function attentionItems(today: string): AttentionItem[] {
  const items: AttentionItem[] = []

  for (const n of listNotices()) {
    const deadline = textField(n, 'bid_submission_deadline')
    const status = textField(n, 'notice_status')

    // A deadline that has passed while the buyer still records the notice as
    // open. Both values are recorded and they disagree, so this is a fact about
    // the corpus rather than an opinion about it.
    if (isISODate(deadline) && deadline < today && status === 'Open') {
      items.push({
        rule: 'notice-open-past-deadline',
        reason: `notice_status is “Open” but bid_submission_deadline ${deadline} is in the past.`,
        recordId: n.id,
        recordType: 'Notice',
      })
    }

    // A deadline that has passed and nothing was ever submitted against it.
    // Uses the recorded deadline only, so a blank deadline never fires this.
    if (isISODate(deadline) && deadline < today && bidsForNotice(n.id).length === 0) {
      items.push({
        rule: 'notice-past-deadline-no-bid',
        reason: `bid_submission_deadline ${deadline} has passed and no bid references this notice.`,
        recordId: n.id,
        recordType: 'Notice',
      })
    }

    }

  for (const b of listBids()) {
    const id = b.id
    const notice = noticeForBid(id)
    const deadline = notice ? textField(notice, 'bid_submission_deadline') : undefined
    const decision = textField(b, 'bid_decision')
    const status = textField(b, 'bid_status')
    const nextAction = textField(b, 'next_action')
    const nextActionDate = textField(b, 'next_action_date')

    // An eligibility claim with nothing behind it. The single most important
    // rule here: `Eligible—verified` asserts a real-world qualification, and
    // free-text evidence notes cannot be checked against anything.
    if (textField(b, 'eligibility_status') === 'Eligible—verified' && sourcesForBid(id).length === 0) {
      items.push({
        rule: 'verified-without-source',
        reason: 'eligibility_status is “Eligible—verified” but evidence_sources cites no source.',
        recordId: id,
        recordType: 'Bid',
      })
    }

    // Still working a bid whose deadline has already gone.
    if (isISODate(deadline) && deadline < today && status === 'Preparing') {
      items.push({
        rule: 'preparing-past-deadline',
        reason: `bid_status is “Preparing” but the notice deadline ${deadline} has passed.`,
        recordId: id,
        recordType: 'Bid',
      })
    }

    // A decision that has not been taken and no next step recorded.
    if (decision === 'Pending' && (!nextAction || nextAction === '')) {
      items.push({
        rule: 'decision-pending-no-action',
        reason: 'bid_decision is “Pending” and next_action is blank.',
        recordId: id,
        recordType: 'Bid',
      })
    }

    // An overdue next action on a bid that has not finished.
    if (isISODate(nextActionDate) && nextActionDate < today && !isTerminalBid(b)) {
      items.push({
        rule: 'next-action-overdue',
        reason: `next_action_date ${nextActionDate} has passed and bid_status is “${status ?? '(blank)'}”, which is not a finished state.`,
        recordId: id,
        recordType: 'Bid',
      })
    }
  }

  return items.sort(
    (a, b) => a.recordType.localeCompare(b.recordType) || a.recordId.localeCompare(b.recordId) || a.rule.localeCompare(b.rule),
  )
}

/** The rules `attentionItems` can emit, with the reason each exists. */
export const ATTENTION_RULES: readonly { rule: string; why: string }[] = [
  {
    rule: 'notice-open-past-deadline',
    why: 'The recorded notice_status and the recorded deadline disagree. Both are stored values, so the disagreement is a fact about the record.',
  },
  {
    rule: 'notice-past-deadline-no-bid',
    why: 'A deadline has passed and nothing references the notice. Fires only on a recorded deadline, never on a blank one.',
  },
  {
    rule: 'verified-without-source',
    why: 'A Bid claims a verified eligibility with no Source cited. This is the highest-consequence gap, because the claim cannot be checked.',
  },
  {
    rule: 'preparing-past-deadline',
    why: 'Work is recorded as ongoing against a deadline that has already passed.',
  },
  {
    rule: 'decision-pending-no-action',
    why: 'The go/no-go decision is unmade and nothing is scheduled to make it.',
  },
  {
    rule: 'next-action-overdue',
    why: 'A recorded next-action date has passed on a bid that has not reached a finished state.',
  },
]

/* ------------------------------------------------------------------ */
/* Filtering                                                           */
/* ------------------------------------------------------------------ */

/** A Notice filter. Every field is optional; `undefined` means "no filter". */
export interface NoticeFilter {
  noticeType?: string
  procurementMethod?: string
  noticeStatus?: string
  lotStructure?: string
  deadline?: DeadlineState
  bids?: 'with' | 'without' | 'any'
}

/**
 * Apply a Notice filter.
 *
 * Conditions combine with AND. A filter whose value matches nothing returns an
 * empty list rather than falling back to "everything", so a zero-result filter
 * is visibly a zero rather than silently ignored.
 */
export function filterNotices(filter: NoticeFilter, today: string): RecordRow[] {
  return listNotices().filter((n) => {
    if (filter.noticeType && textField(n, 'notice_type') !== filter.noticeType) return false
    if (filter.procurementMethod && textField(n, 'procurement_method') !== filter.procurementMethod) return false
    if (filter.noticeStatus && textField(n, 'notice_status') !== filter.noticeStatus) return false
    if (filter.lotStructure && textField(n, 'lot_structure') !== filter.lotStructure) return false
    if (filter.deadline && noticeDeadlineState(n, today) !== filter.deadline) return false
    if (filter.bids === 'with' && bidsForNotice(n.id).length === 0) return false
    if (filter.bids === 'without' && bidsForNotice(n.id).length > 0) return false
    return true
  })
}

/** A Bid filter, across the three axes plus company and notice. */
export interface BidFilter {
  eligibility?: string
  decision?: string
  status?: string
  companyId?: string
  noticeId?: string
  deadline?: DeadlineState
}

/** Apply a Bid filter. Conditions combine with AND. */
export function filterBids(filter: BidFilter, today: string): RecordRow[] {
  return listBids().filter((b) => {
    if (filter.eligibility && textField(b, 'eligibility_status') !== filter.eligibility) return false
    if (filter.decision && textField(b, 'bid_decision') !== filter.decision) return false
    if (filter.status && textField(b, 'bid_status') !== filter.status) return false
    if (filter.companyId && companyForBid(b.id)?.id !== filter.companyId) return false
    if (filter.noticeId && noticeForBid(b.id)?.id !== filter.noticeId) return false
    if (filter.deadline && bidDeadlineState(b, today) !== filter.deadline) return false
    return true
  })
}

/* ------------------------------------------------------------------ */
/* Contract filtering                                                   */
/* ------------------------------------------------------------------ */

export interface ContractFilter {
  status?: string
  acceptance?: string
  payment?: string
  security?: string
  companyId?: string
  noticeId?: string
  bidId?: string
  /**
   * `with_bid` / `without_bid` / undefined-for-any.
   *
   * The third state matters. A single-source award legitimately has no Bid, so
   * "no bid" is a category of contract to be inspected, not a data defect to be
   * filtered out of existence. Both directions are offered on purpose.
   */
  bidPresence?: 'with_bid' | 'without_bid'
  currency?: string
}

/**
 * Apply a Contract filter. Conditions combine with AND.
 *
 * The four status conditions are independent, exactly as the four fields are on
 * the record. Filtering by `status: Active` does not imply anything about
 * acceptance or payment: `CON-002` is `Delivered`, `Under inspection`, and
 * `Partially paid` simultaneously, and a reader asking each of those questions
 * separately must be able to.
 */
export function filterContracts(filter: ContractFilter): RecordRow[] {
  return listContracts().filter((c) => {
    if (filter.status && textField(c, 'contract_status') !== filter.status) return false
    if (filter.acceptance && textField(c, 'acceptance_status') !== filter.acceptance) return false
    if (filter.payment && textField(c, 'payment_status') !== filter.payment) return false
    if (filter.security && textField(c, 'performance_security_status') !== filter.security)
      return false
    if (filter.companyId && companyForContract(c.id)?.id !== filter.companyId) return false
    if (filter.noticeId && noticeForContract(c.id)?.id !== filter.noticeId) return false
    if (filter.bidId && bidForContract(c.id)?.id !== filter.bidId) return false
    if (filter.bidPresence === 'with_bid' && !bidForContract(c.id)) return false
    if (filter.bidPresence === 'without_bid' && bidForContract(c.id)) return false
    if (filter.currency && textField(c, 'contract_value_currency') !== filter.currency) return false
    return true
  })
}

/**
 * Currencies actually present on Contract records, for the currency filter.
 *
 * Derived from the data rather than from a list of world currencies, because the
 * only honest set of options is the set the vault can actually answer for. An
 * option offering a currency with no records would return an empty list and read
 * as a broken filter.
 *
 * Currency is offered as a filter — never as a grouping total — precisely because
 * amounts here are not summable across currencies.
 */
export function contractCurrencies(contracts: RecordRow[]): string[] {
  const seen = new Set<string>()
  for (const c of contracts) {
    const cur = textField(c, 'contract_value_currency')
    if (cur) seen.add(cur)
  }
  return [...seen].sort(cmp)
}

/* ------------------------------------------------------------------ */
/* Sorting                                                             */
/* ------------------------------------------------------------------ */

export type NoticeSort = 'deadline' | 'title' | 'buyer' | 'type' | 'id'
export type BidSort = 'status' | 'decision' | 'eligibility' | 'deadline' | 'id'
export type ContractSort = 'status' | 'end' | 'value' | 'id'

/**
 * Stable string comparison.
 *
 * `localeCompare` with an explicit numeric option, so ordering is deterministic
 * across locales and does not depend on the viewer's language settings for a
 * value the vault stored in a fixed form.
 */
const cmp = (a: string, b: string): number =>
  a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' })

/**
 * Sort Notices.
 *
 * BLANK DATES SORT LAST in the deadline ordering. A missing deadline is not an
 * early deadline, and putting it first would put unknown records at the top of
 * an operational list. Every sort falls back to record ID so equal keys produce
 * a total order — two runs on the same data always render the same sequence.
 *
 * Note there is no `today` parameter here, unlike the classifiers above. Sorting
 * orders dates against each other, which needs no reference point; only
 * classifying a date as upcoming-or-past requires knowing what day it is.
 */
export function sortNotices(notices: RecordRow[], sort: NoticeSort): RecordRow[] {
  const dated = (n: RecordRow): string => textField(n, 'bid_submission_deadline') ?? ''
  const out = [...notices]
  out.sort((a, b) => {
    switch (sort) {
      case 'deadline': {
        const da = dated(a)
        const db = dated(b)
        if (da === '' && db === '') return cmp(a.id, b.id)
        if (da === '') return 1
        if (db === '') return -1
        return cmp(da, db) || cmp(a.id, b.id)
      }
      case 'title':
        return cmp(titleOfRecord(a), titleOfRecord(b)) || cmp(a.id, b.id)
      case 'buyer': {
        const ba = procuringEntityForNotice(a.id)?.id ?? ''
        const bb = procuringEntityForNotice(b.id)?.id ?? ''
        return cmp(ba, bb) || cmp(a.id, b.id)
      }
      case 'type':
        return cmp(textField(a, 'notice_type') ?? '', textField(b, 'notice_type') ?? '') || cmp(a.id, b.id)
      case 'id':
        return cmp(a.id, b.id)
    }
  })
  return out
}

/**
 * Sort Bids.
 *
 * Deadline ordering resolves the parent Notice, so a Bid is ordered by the date
 * that actually governs it rather than by a field it does not have. Blanks sort
 * last, for the same reason as Notices.
 */
export function sortBids(bids: RecordRow[], sort: BidSort): RecordRow[] {
  const deadlineOf = (b: RecordRow): string => {
    const n = noticeForBid(b.id)
    return n ? textField(n, 'bid_submission_deadline') ?? '' : ''
  }
  const out = [...bids]
  out.sort((a, b) => {
    switch (sort) {
      case 'status':
        return cmp(textField(a, 'bid_status') ?? '', textField(b, 'bid_status') ?? '') || cmp(a.id, b.id)
      case 'decision':
        return cmp(textField(a, 'bid_decision') ?? '', textField(b, 'bid_decision') ?? '') || cmp(a.id, b.id)
      case 'eligibility':
        return cmp(textField(a, 'eligibility_status') ?? '', textField(b, 'eligibility_status') ?? '') || cmp(a.id, b.id)
      case 'deadline': {
        const da = deadlineOf(a)
        const db = deadlineOf(b)
        if (da === '' && db === '') return cmp(a.id, b.id)
        if (da === '') return 1
        if (db === '') return -1
        return cmp(da, db) || cmp(a.id, b.id)
      }
      case 'id':
        return cmp(a.id, b.id)
    }
  })
  return out
}

/**
 * Sort Contracts.
 *
 * `status` follows the Phase 1 section 8.6 lifecycle order rather than
 * alphabetical, so the list reads Awarded -> Active -> Delivered -> Accepted ->
 * Completed, with Under dispute and Terminated reachable from Active. Alphabetical
 * would put "Accepted" before "Active" and "Awarded" first of all, which is a
 * different and less useful story.
 *
 * `end` sorts by `contract_end_date` with BLANKS LAST, for the same reason Notice
 * deadlines do: a contract with no recorded end date is not ending soonest, and
 * putting it first would put the least-known records at the top.
 *
 * `value` sorts by amount WITHOUT converting currencies. It is a within-currency
 * ordering of the raw numbers, and the header says so — sorting does not add
 * anything across currencies, and no total is offered anywhere.
 */
export function sortContracts(contracts: RecordRow[], sort: ContractSort): RecordRow[] {
  const out = [...contracts]
  out.sort((a, b) => {
    switch (sort) {
      case 'status': {
        const oa = CONTRACT_STATUS_ORDER.indexOf(textField(a, 'contract_status') ?? '')
        const ob = CONTRACT_STATUS_ORDER.indexOf(textField(b, 'contract_status') ?? '')
        // An unrecognised status sorts last rather than first, so a new vocabulary
        // value cannot silently displace the known lifecycle.
        const ra = oa === -1 ? CONTRACT_STATUS_ORDER.length : oa
        const rb = ob === -1 ? CONTRACT_STATUS_ORDER.length : ob
        return ra - rb || cmp(a.id, b.id)
      }
      case 'end': {
        const da = textField(a, 'contract_end_date') ?? ''
        const db = textField(b, 'contract_end_date') ?? ''
        if (da === '' && db === '') return cmp(a.id, b.id)
        if (da === '') return 1
        if (db === '') return -1
        return cmp(da, db) || cmp(a.id, b.id)
      }
      case 'value': {
        const na = numberField(a, 'contract_value') ?? Number.NEGATIVE_INFINITY
        const nb = numberField(b, 'contract_value') ?? Number.NEGATIVE_INFINITY
        return na - nb || cmp(a.id, b.id)
      }
      case 'id':
        return cmp(a.id, b.id)
    }
  })
  return out
}

/** Local title lookup, avoiding a circular import with `selectors.titleOf`. */
function titleOfRecord(rec: RecordRow): string {
  const nameKey = rec.type === 'notice' ? 'notice_name' : rec.id
  return textField(rec, nameKey) ?? rec.id
}