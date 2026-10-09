/**
 * Phase 7 — document visibility for Notice, Bid and Contract.
 *
 * One component serves all three record types because the underlying concept is
 * the same everywhere: a list of document NAMES with no file behind it. Phase 1
 * founder decision D10 settles storage as "names only", so nothing here renders
 * a link, a download, a path, or a file size. There is no `<a href>` to a
 * document anywhere in this component, and adding one would need the storage
 * decision D10 explicitly declined.
 *
 * ## Accessibility
 *
 * Status is never carried by colour alone. Every name that is outstanding
 * carries a visible text marker ("not completed") in addition to its tone, and
 * the status itself is rendered as a word next to the counts. The section is a
 * `<section>` with a real heading so it is reachable by heading navigation and
 * announced correctly, and each list is a real `<ul>`.
 *
 * Counts are announced as text rather than as a bare numeral, so a screen
 * reader says "3 of 4 completed" instead of two disconnected numbers.
 */

import { Link } from 'react-router-dom'
import { StatusBadge } from '../ui/Badges'
import {
  DOCUMENT_SET_STATUS_LABEL,
  DOCUMENT_SET_STATUS_NOTE,
  documentSetFor,
  mandatoryCoverageFor,
  mandatoryDocumentsFor,
} from '../../data/documents'
import type { MandatoryCoverage } from '../../data/documents'
import { pathForRecord } from '../../data/selectors'
import type { RecordRow } from '../../types/records'

/**
 * A named document list, with an explicit per-item state where one applies.
 *
 * `mark` is a short word printed next to the name. It is the non-colour channel
 * that makes "outstanding" readable without relying on the tone, so it must
 * never be removed for visual tidiness.
 */
function DocumentList({
  names,
  mark,
  emptyNote,
}: {
  names: readonly string[]
  /** Visible text marker for each name, or null for an unmarked list. */
  mark: ((name: string) => string) | null
  emptyNote: string
}) {
  if (names.length === 0) {
    return <p className="value value--absent">{emptyNote}</p>
  }
  return (
    <ul className="doclist">
      {names.map((name) => (
        <li key={name} className="doclist__item">
          <span className="doclist__name">{name}</span>
          {mark ? <span className="doclist__mark">{mark(name)}</span> : null}
        </li>
      ))}
    </ul>
  )
}

/**
 * A Bid's document set: required, completed, and what is outstanding.
 *
 * The three lists are rendered in full rather than as a single combined list,
 * because the reader's question is "what is left", and that is answered by the
 * missing list directly. `required` and `completed` are shown as the recorded
 * evidence behind that answer.
 *
 * No percentage and no score. `n of m` is the whole claim the two lists support.
 */
function BidDocumentSet({ bid }: { bid: RecordRow }) {
  const set = documentSetFor(bid)
  const coverage = mandatoryCoverageFor(bid)

  return (
    <section className="card" aria-labelledby="docset-heading">
      <h2 className="card__title" id="docset-heading">
        Document set
      </h2>
      <p className="card__note">
        Derived from this bid’s own two lists. A document is named, not attached — the vault records
        no files, and no name here can be opened. Phase 1 decision D10 sets storage as names only.
      </p>

      <div className="minigrid">
        <div className="mini">
          <span className="mini__count">
            {set.completedCount} of {set.requiredCount}
          </span>
          <span className="mini__label">required documents recorded as completed</span>
        </div>
        <div className="mini">
          <span className="mini__count">{set.missingCount}</span>
          <span className="mini__label">
            outstanding
            {set.missingCount === 1 ? '' : 's'} from <code>required_documents</code>
          </span>
        </div>
      </div>

      <p className="docset__status">
        <StatusBadge
          label={DOCUMENT_SET_STATUS_LABEL[set.status]}
          tone={set.status === 'complete' ? 'neutral' : 'muted'}
          title="Derived from required_documents and completed_documents"
        />
        <span className="docset__statusnote">{DOCUMENT_SET_STATUS_NOTE[set.status]}</span>
      </p>

      <h3 className="companysummary__axislabel">Outstanding</h3>
      <DocumentList
        names={set.missing}
        mark={() => 'not completed'}
        emptyNote={
          set.requiredCount === 0
            ? 'Nothing to show. This bid requires no documents, or records no required list.'
            : 'None. Every required document is recorded as completed.'
        }
      />

      <h3 className="companysummary__axislabel">Required</h3>
      <DocumentList
        names={set.required}
        mark={null}
        emptyNote="No required_documents recorded on this bid."
      />

      <h3 className="companysummary__axislabel">Recorded as completed</h3>
      <DocumentList
        names={set.completed}
        mark={null}
        emptyNote="No completed_documents recorded on this bid."
      />

      {set.blanks.length > 0 ? (
        <p className="value value--blank">
          {set.blanks.length} blank name{set.blanks.length === 1 ? '' : 's'} present. The importer
          rejects these, so this card is being shown against a snapshot that bypassed validation.
        </p>
      ) : null}
      {set.duplicates.length > 0 ? (
        <p className="value value--blank">
          {set.duplicates.length} name{set.duplicates.length === 1 ? '' : 's'} repeated within a
          list. Counts above deduplicate; the importer rejects this too.
        </p>
      ) : null}

      {coverage.noticeId ? (
        <MandatoryOverlap coverage={coverage} />
      ) : (
        <p className="card__foot">
          No notice recorded, so there is no buyer mandate to compare this list against.
        </p>
      )}
    </section>
  )
}

/**
 * What the parent Notice demands, and how much of it this bid names.
 *
 * Reported as an observation, not a verdict. Phase 1 sets no containment rule
 * between `Notice.mandatory_bid_documents` and `Bid.required_documents`, and a
 * partial or multi-lot award can legitimately name a different set — so nothing
 * here is styled as a pass or a failure.
 */
function MandatoryOverlap({ coverage }: { coverage: MandatoryCoverage }) {
  if (coverage.mandatory.length === 0) {
    return (
      <p className="card__foot">
        <Link to={pathForRecord(coverage.noticeId ?? '') ?? '#'}>{coverage.noticeId}</Link> records
        no mandatory bid documents, so there is no buyer mandate to compare against.
      </p>
    )
  }
  return (
    <div className="docset__overlap">
      <h3 className="companysummary__axislabel">Against the buyer’s mandate</h3>
      <p className="card__note">
        <Link to={pathForRecord(coverage.noticeId ?? '') ?? '#'}>{coverage.noticeId}</Link> marks{' '}
        {coverage.mandatory.length} document{coverage.mandatory.length === 1 ? '' : 's'} mandatory
        for every bidder. This bid names {coverage.namedInBid.length} of them. This is an
        observation, not a check — Phase 1 sets no rule requiring one list to contain the other,
        and a partial award may legitimately name a different set.
      </p>
      <DocumentList
        names={coverage.notNamedInBid}
        mark={() => 'not named in this bid'}
        emptyNote="This bid names every document its notice marks mandatory."
      />
    </div>
  )
}

/**
 * A Notice's buyer mandate.
 *
 * Deliberately NOT presented as a checklist. Nothing on this page has been
 * completed by anyone: the buyer stated a requirement and this vault has not
 * tracked any bidder against it. Rendering ticks here would invent a second
 * completion record that the schema has nowhere to store.
 */
function NoticeMandatoryDocuments({ notice }: { notice: RecordRow }) {
  const mandatory = mandatoryDocumentsFor(notice)
  return (
    <section className="card" aria-labelledby="mandatory-heading">
      <h2 className="card__title" id="mandatory-heading">
        Documents the buyer requires
      </h2>
      <p className="card__note">
        <code>mandatory_bid_documents</code> — what the buyer demands from <em>every</em> bidder.
        This is not a completion record. Whether any one company has finished these lives on that
        company’s own bid as <code>completed_documents</code>, and nowhere on this page.
      </p>
      <DocumentList
        names={mandatory}
        mark={null}
        emptyNote="This notice records no mandatory bid documents. The list is present and empty, which is not the same as it being absent."
      />
    </section>
  )
}

/**
 * Contract's explicit absence of document fields.
 *
 * Phase 1 defines 27 Contract fields and none of them is a document list — no
 * `contract_documents`, no `evidence_sources`, no deliverables file. Phase 6
 * implemented that schema as written. So there is nothing to render, and the
 * honest thing is to say so on the page rather than leave a reader wondering
 * whether the module forgot.
 *
 * Adding a field here would mean inventing a requirement the authoritative
 * design does not contain.
 */
function ContractHasNoDocuments() {
  return (
    <section className="card card--muted" aria-labelledby="contract-docs-heading">
      <h2 className="card__title" id="contract-docs-heading">
        Documents
      </h2>
      <p className="card__note">
        Contract records no documents. Its 27-field schema has no document list, no deliverables
        file and no evidence source, and Phase 7 added none. Delivery obligations are recorded as{' '}
        <code>delivery_scope</code> and <code>milestones</code>, which are scope and schedule, not
        attachments.
      </p>
      <p className="card__foot">
        Where a contract does need a document — the signed instrument, say — the evidence trail
        lives on the Source records behind the originating bid’s <code>evidence_sources</code>.
      </p>
    </section>
  )
}

/**
 * Entry point: the document section appropriate to a record type.
 *
 * Returns null for the record types that own no document field, so a page can
 * drop it in unconditionally rather than branching on record type itself.
 */
export function DocumentSection({ rec }: { rec: RecordRow }) {
  if (rec.type === 'bid') return <BidDocumentSet bid={rec} />
  if (rec.type === 'notice') return <NoticeMandatoryDocuments notice={rec} />
  if (rec.type === 'contract') return <ContractHasNoDocuments />
  return null
}