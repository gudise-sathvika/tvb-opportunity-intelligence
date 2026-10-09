import { Link } from 'react-router-dom'
import ThemeToggle from '../components/ui/ThemeToggle'
import { COMPANY_DIRECTORY_NAMES } from '../data/company-directory-names'

/**
 * The standalone landing page.
 *
 * Rendered outside the application shell, so it has no top navigation and no
 * sidebar: it is a product front door, not an application screen. The three
 * workspace cards are Funding, Procurement, and Companies (the participant
 * universe). Home is this page itself.
 */
export default function Landing() {
  return (
    <main className="landing">
      <div className="landing__inner">
        <div className="landing__topbar">
          <span className="topnav__brand">
            <span className="topnav__mark" aria-hidden="true" />
            TVB Opportunity Intelligence
          </span>
          <ThemeToggle />
        </div>

        <section className="landing__hero">
          <p className="landing__eyebrow">TVB Opportunity Intelligence</p>
          <h1 className="landing__title">
            Discover opportunities.
            <br />
            Turn them into action.
          </h1>
          <p className="landing__subtitle">
            One intelligence workspace for funding and procurement. Track grants from discovery to
            application, and requests for proposals from publication to contract, across the whole
            company universe.
          </p>
        </section>

        <section className="landing__cards" aria-label="Product areas">
          <article className="landing-card">
            <span className="landing-card__index">01</span>
            <h2 className="landing-card__title">Funding</h2>
            <ul className="landing-card__concepts">
              <li>Organizations</li>
              <li>Grants</li>
            </ul>
            <p className="landing-card__flow">
              <strong>Find</strong>
              <span aria-hidden="true">→</span>
              <strong>Match</strong>
              <span aria-hidden="true">→</span>
              <strong>Apply</strong>
            </p>
            <Link to="/funding" className="landing-card__cta">
              Explore Funding <span aria-hidden="true">→</span>
            </Link>
          </article>

          <article className="landing-card">
            <span className="landing-card__index">02</span>
            <h2 className="landing-card__title">Procurement</h2>
            <ul className="landing-card__concepts">
              <li>Organizations</li>
              <li>RFP</li>
            </ul>
            <p className="landing-card__flow">
              <strong>Find</strong>
              <span aria-hidden="true">→</span>
              <strong>Bid</strong>
              <span aria-hidden="true">→</span>
              <strong>Contract</strong>
            </p>
            <Link to="/procurement" className="landing-card__cta">
              Explore Procurement <span aria-hidden="true">→</span>
            </Link>
          </article>

          <article className="landing-card">
            <span className="landing-card__index">03</span>
            <h2 className="landing-card__title">Companies</h2>
            <p className="landing-card__lead">
              Companies are the central participant universe. Each one sits in both workflows — in
              funding as a Grant matched and applied for, and in procurement as an RFP pursued through
              a bid to a contract. {COMPANY_DIRECTORY_NAMES.length} companies are currently tracked.
            </p>
            <Link to="/companies" className="landing-card__cta">
              Explore Companies <span aria-hidden="true">→</span>
            </Link>
          </article>
        </section>
      </div>
    </main>
  )
}
