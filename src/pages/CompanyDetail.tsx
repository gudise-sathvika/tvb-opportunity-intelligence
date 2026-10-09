import { Link } from 'react-router-dom'
import RecordDetailPage from '../components/records/RecordDetail'
import { StatusBadge } from '../components/ui/Badges'
import DeadlineBadge from '../components/records/DeadlineBadge'
import {
  bidDeadlineState,
  bidsByAxis,
  isTerminalBid,
  todayISO,
} from '../data/procurement'
import {
  applicationsForCompany,
  bidsForCompany,
  contractsForCompany,
  field,
  matchesForCompany,
  noticeForBid,
  opportunityForApplication,
  opportunityForMatch,
  pathForRecord,
  textField,
} from '../data/selectors'
import type { RecordRow } from '../types/records'
import type { RelatedGroup } from '../components/records/RecordDetail'

/**
 * Company detail — the intelligence view.
 *
 * Phase Z leads with the business questions instead of the raw field list: a
 * section navigation (Overview, Funding, Procurement, Matches, Applications,
 * Bids, Contracts) and an overview card whose figures link to what they count,
 * followed by the Funding and Procurement activity summaries. The complete
 * field list, related records, notes body, and provenance remain untouched
 * underneath — nothing was hidden to make room for the overview; the overview
 * was added in front of it.
 *
 * The funding relationships (Matches, Applications) are unchanged from the Phase
 * 2 build. Bids joins them in Phase 4 and is the company's procurement pipeline:
 * Phase 1 section 7.1 makes Company 1:N Bid a confirmed requirement, so a reader
 * can see everything this company has pursued, not just what it matched.
 *
 * A company record gained no new frontmatter field. The Bid relationship is
 * derived by reversing `Bid.company`, exactly as `matchesForCompany` derives from
 * the match index, so there is one relationship algorithm rather than two.
 *
 * Phase 5 adds a procurement summary above the field list. It reports the shape of
 * this company's bid pipeline: how many bids, how many notices they answer, how
 * many bids have reached a finished state, and the distribution along each of the
 * three axes separately.
 *
 * What it deliberately does not report: a win rate, an average cycle time, or a
 * "success" count beyond the literal number of bids marked `Awarded`. A company
 * with one bid and one award has a 100% rate and one data point; printing the
 * rate would present a rounding artifact as a performance measurement.
 *
 * Phase 6 adds a fourth relationship group, Contracts. It answers a question the
 * Bids group structurally cannot: what is this company actually obliged to
 * deliver right now. A single-source or negotiated award produces a contract with
 * no Bid at all, so it is invisible from the pipeline view — the contract is the
 * only record that exists. The view keeps such records visible even when no bid
 * is linked to them.
 */
const groups = (rec: RecordRow): RelatedGroup[] => [
  { label: 'Matches', records: matchesForCompany(rec.id), emptyNote: 'No matches recorded' },
  {
    label: 'Applications',
    records: applicationsForCompany(rec.id),
    emptyNote: 'No applications recorded',
  },
  {
    label: 'Bids',
    records: bidsForCompany(rec.id),
    emptyNote:
      'No bids recorded. One Company has 1:N Bids, so an empty list means nothing has been pursued yet.',
  },
  {
    label: 'Contracts',
    records: contractsForCompany(rec.id),
    emptyNote:
      'No contracts recorded. Note that a contract here with no matching bid above is not an inconsistency: a single-source or negotiated award has no competing bid to point at, and contract_basis records why.',
  },
]

/** One axis's distribution, showing only values this company actually has. */
function AxisSummary({ axis, bids }: { axis: 'eligibility_status' | 'bid_decision' | 'bid_status'; bids: RecordRow[] }) {
  const groups = bidsByAxis(bids, axis).filter((g) => g.count > 0)
  if (groups.length === 0) return null

  const axisLabel =
    axis === 'eligibility_status' ? 'Eligibility' : axis === 'bid_decision' ? 'Decision' : 'Bid status'

  return (
    <div className="companysummary__axis">
      <h3 className="companysummary__axislabel">
        {axisLabel} <code>{axis}</code>
      </h3>
      <ul className="chips">
        {groups.map((g) => (
          <li key={g.value}>
            <StatusBadge label={g.value} />
            <span className="chips__count">{g.count}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * The procurement summary for one company.
 *
 * Notices reached is derived through the bids, not from any company-to-notice
 * field, because Company has no such relationship. A notice is "reached" when
 * this company has a bid against it, which is a fact about the bid index and not
 * a claim that the company was ever formally approved by the buyer.
 */
function FundingSummary({ rec }: { rec: RecordRow }) {
  const matches = matchesForCompany(rec.id)
  const apps = applicationsForCompany(rec.id)
  const opportunitiesFromMatches = [...new Set(matches.map((m) => opportunityForMatch(m.id)?.id).filter(Boolean))]
  const opportunitiesFromApps = [...new Set(apps.map((a) => opportunityForApplication(a.id)?.id).filter(Boolean))]
  const opportunitiesReached = [...new Set([...opportunitiesFromMatches, ...opportunitiesFromApps])]

  if (matches.length === 0 && apps.length === 0) {
    return (
      <div className="card" id="funding-activity">
        <h2 className="card__title">Funding activity</h2>
        <p className="card__note">
          This company has no matches or applications recorded, so there is no funding activity to
          summarise.
        </p>
      </div>
    )
  }

  return (
    <div className="card" id="funding-activity">
      <h2 className="card__title">Funding activity</h2>
      <p className="card__note">
        Derived from the {matches.length} match{matches.length === 1 ? '' : 'es'} and{' '}
        {apps.length} application{apps.length === 1 ? '' : 's'} linked to this company. Counts only —
        no win rate or success measurement beyond recorded links.
      </p>

      <div className="minigrid">
        <div className="mini">
          <span className="mini__count">{matches.length}</span>
          <span className="mini__label">matches recorded</span>
        </div>
        <div className="mini">
          <span className="mini__count">{apps.length}</span>
          <span className="mini__label">applications recorded</span>
        </div>
        <div className="mini">
          <span className="mini__count">{opportunitiesReached.length}</span>
          <span className="mini__label">
            distinct opportunit{opportunitiesReached.length === 1 ? 'y' : 'ies'} reached
          </span>
        </div>
      </div>
    </div>
  )
}

function ProcurementSummary({ rec }: { rec: RecordRow }) {
  const today = todayISO()
  const bids = bidsForCompany(rec.id)

  if (bids.length === 0) {
    return (
      <div className="card" id="procurement-activity">
        <h2 className="card__title">Procurement activity</h2>
        <p className="card__note">
          This company has no bids recorded, so there is no procurement activity to summarise. It
          may simply not have pursued anything yet — an empty pipeline is not a signal.
        </p>
        <p className="card__foot">
          <Link to="/procurement">See the procurement workspace</Link>
        </p>
      </div>
    )
  }

  // Derived through the bids rather than from a company-to-notice field, which
  // does not exist. Deduplicated, since two bids on one notice would otherwise
  // report that notice twice.
  const notices = [...new Set(bids.map((b) => noticeForBid(b.id)?.id).filter(Boolean))]
  const terminal = bids.filter((b) => isTerminalBid(b))
  const awarded = bids.filter((b) => textField(b, 'bid_status') === 'Awarded')
  const bidsChasingPast = bids.filter((b) => bidDeadlineState(b, today) === 'past')

  return (
    <div className="card" id="procurement-activity">
      <h2 className="card__title">Procurement activity</h2>
      <p className="card__note">
        Derived from the {bids.length} bid record{bids.length === 1 ? '' : 's'} linked to this
        company. Counts only — no win rate, cycle time, or score, because the snapshot does not record
        the data those would need.
      </p>

      <div className="minigrid">
        <div className="mini">
          <span className="mini__count">{bids.length}</span>
          <span className="mini__label">bids recorded</span>
        </div>
        <div className="mini">
          <span className="mini__count">{notices.length}</span>
          <span className="mini__label">
            notice{notices.length === 1 ? '' : 's'} reached through those bids
          </span>
        </div>
        <div className="mini">
          <span className="mini__count">{terminal.length}</span>
          <span className="mini__label">
            in a finished state (of {bids.length})
          </span>
        </div>
        <div className="mini">
          <span className="mini__count">{awarded.length}</span>
          <span className="mini__label">marked awarded</span>
        </div>
      </div>

      {bidsChasingPast.length > 0 ? (
        <p className="card__foot">
          {bidsChasingPast.length} bid{bidsChasingPast.length === 1 ? '' : 's'} on this company
          answer{bidsChasingPast.length === 1 ? 's' : ''} a notice whose submission deadline is in
          the past as of <code>{today}</code>. See{' '}
          <Link to={`/bids?company=${rec.id}`}>this company's bids</Link>.
        </p>
      ) : null}

      <div className="companysummary__axes">
        <AxisSummary axis="eligibility_status" bids={bids} />
        <AxisSummary axis="bid_decision" bids={bids} />
        <AxisSummary axis="bid_status" bids={bids} />
      </div>

      <h3 className="companysummary__axislabel">Bids</h3>
      <ul className="recents">
        {bids.map((b) => {
          const notice = noticeForBid(b.id)
          return (
            <li key={b.id} className="recents__row">
              <Link to={pathForRecord(b.id) ?? '#'} className="recents__link">
                {b.id}
              </Link>
              <span className="recents__meta">
                {notice ? (
                  <>
                    against{' '}
                    <Link to={pathForRecord(notice.id) ?? '#'}>{notice.id}</Link>
                  </>
                ) : (
                  'no notice recorded'
                )}
              </span>
              <span className="recents__date">
                <StatusBadge label={textField(b, 'bid_status') ?? '(blank)'} />
              </span>
              <span className="recents__date">
                {notice ? (
                  <DeadlineBadge date={field(notice, 'bid_submission_deadline')} today={today} />
                ) : null}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * Section navigation for the company intelligence view.
 *
 * Native anchor links, not a router component: each target is an id on this
 * same page, so the browser's own fragment handling applies and the headings
 * remain the semantic structure. `scroll-margin-top` in the stylesheet keeps
 * the sticky top nav from covering the destination.
 */
const SECTION_TABS = [
  { label: 'Overview', href: '#company-overview' },
  { label: 'Funding', href: '#funding-activity' },
  { label: 'Procurement', href: '#procurement-activity' },
  { label: 'Matches', href: '#related-matches' },
  { label: 'Applications', href: '#related-applications' },
  { label: 'Bids', href: '#related-bids' },
  { label: 'Contracts', href: '#related-contracts' },
] as const

export default function CompanyDetail() {
  return (
    <RecordDetailPage
      recordType="company"
      related={groups}
      beforeFields={(rec) => {
        const matches = matchesForCompany(rec.id)
        const apps = applicationsForCompany(rec.id)
        const bids = bidsForCompany(rec.id)
        const notices = [...new Set(bids.map((b) => noticeForBid(b.id)?.id).filter(Boolean))]

        return (
          <>
            <nav className="sectiontabs" aria-label="Company sections">
              {SECTION_TABS.map((tab) => (
                <a key={tab.href} href={tab.href} className="sectiontabs__tab">
                  {tab.label}
                </a>
              ))}
            </nav>

            <section className="card" id="company-overview">
              <h2 className="card__title">Overview</h2>
              <p className="card__note">
                What this company is involved in right now, derived from the current snapshot. Every
                figure links to the records it counts.
              </p>
              <div className="minigrid">
                <a href="#funding-activity" className="mini">
                  <span className="mini__count">{matches.length + apps.length}</span>
                  <span className="mini__label">
                    match{matches.length + apps.length === 1 ? '' : 'es'} & applications
                  </span>
                </a>
                <a href="#procurement-activity" className="mini">
                  <span className="mini__count">{bids.length}</span>
                  <span className="mini__label">
                    bid{bids.length === 1 ? '' : 's'} in the pipeline
                  </span>
                </a>
                <a href="#procurement-activity" className="mini">
                  <span className="mini__count">{notices.length}</span>
                  <span className="mini__label">
                    RFP{notices.length === 1 ? '' : 's'} engaged through those bids
                  </span>
                </a>
              </div>
            </section>

            <FundingSummary rec={rec} />
            <ProcurementSummary rec={rec} />
          </>
        )
      }}
    />
  )
}