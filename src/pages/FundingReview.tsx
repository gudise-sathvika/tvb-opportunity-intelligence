/**
 * Phase 36 dedicated Funding Review route (`/review/funding`).
 *
 * Same shared review store, decisions, filters, and pagination as Human
 * review — scoped to funding records only. Procurement and unclassified
 * records stay on their own views; nothing is duplicated or discarded.
 */

import ReviewQueue from '../components/review/ReviewQueue'

export default function FundingReview() {
  return <ReviewQueue domainFilter="funding" title="Funding review" />
}
