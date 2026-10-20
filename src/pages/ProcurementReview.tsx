/**
 * Phase 36 dedicated Procurement Review route (`/review/procurement`).
 *
 * Same shared review store, decisions, filters, and pagination as Human
 * review — scoped to procurement records only. Funding and unclassified
 * records stay on their own views; nothing is duplicated or discarded.
 */

import ReviewQueue from '../components/review/ReviewQueue'

import { Link } from 'react-router-dom'

export default function ProcurementReview() {
  return (
    <>
      <Link to="/review" className="btn">Review Candidates</Link>
      <ReviewQueue domainFilter="procurement" title="Procurement review" />
    </>
  )
}
