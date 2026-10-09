import { Link } from 'react-router-dom'

/** Catch-all for an unknown path. Says so plainly; invents nothing. */
export default function NotFound() {
  return (
    <section className="page">
      <h1 className="page__title">Page not found</h1>
      <div className="empty" role="alert">
        <p className="empty__headline">That page does not exist in this application</p>
        <p className="empty__body">
          The address you followed is not one of the application's routes. Nothing was created.
        </p>
        <p>
          <Link to="/" className="btn">
            Back to Home
          </Link>
        </p>
      </div>
    </section>
  )
}
