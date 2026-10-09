/**
 * Shared record-detail pattern.
 *
 * Shows every frontmatter field of the record, in the snapshot's stored
 * (template) order, with blank strings, empty lists, and absent keys shown
 * distinctly. Link fields render as navigable links where they resolve.
 *
 * The relationship panel is driven entirely by the importer's relationship
 * indexes. A relationship that is not recorded is stated as "not recorded",
 * never omitted silently and never inferred.
 */

import { Link, useParams } from 'react-router-dom'
import { StatusBadge } from '../ui/Badges'
import { ValueDisplay } from '../ui/ValueDisplay'
import BackNavigation from '../navigation/BackNavigation'
import { rfpDisplay } from '../vocabulary'
import WikilinkField from './WikilinkField'
import MarkdownBody from './MarkdownBody'
import { SCHEMAS } from '../../import/schema'
import { statusFieldsFor } from '../../data/status-fields'
import {
  COLLECTION_OF as COLLECTION_OF_BY_TYPE,
  COLLECTION_PATH,
  getRecord,
  listRecords,
  pathForRecord,
  titleOf,
  type CollectionKey,
} from '../../data/selectors'
import { TYPE_LABEL, TYPE_PLURAL_LABEL } from '../../types/registry'
import type { ReactNode } from 'react'
import type { RecordRow, RecordType } from '../../types/records'

/** Related-record group: a label, records, and an explicit empty message. */
export interface RelatedGroup {
  label: string
  records: RecordRow[]
  /** Shown when the group is empty, so absence is explicit. */
  emptyNote?: string
}

/**
 * Record type -> collection key.
 *
 * Derived from the registry rather than restated. This map used to be a
 * hand-written literal that had to be extended by hand for every new record
 * type; the TypeScript error was the only thing catching a missed entry.
 * `COLLECTION_OF` in `data/selectors` is itself registry-derived, so reusing it
 * keeps one derivation rather than two that can disagree.
 */
const COLLECTION_OF: Record<RecordType, CollectionKey> = COLLECTION_OF_BY_TYPE

const listPathFor = (type: RecordType): string => `/${COLLECTION_PATH[COLLECTION_OF[type]]}`

/**
 * User-facing label for a record's parent collection.
 *
 * Product vocabulary, not schema vocabulary: the funding collection is shown as
 * "Grants" and the procurement collection as "RFP" throughout the navigation,
 * even though the records are Opportunities and Notices underneath. Every other
 * type keeps its registry plural label, so the back control never restates a
 * hand-written list that could drift from the registry.
 */
const BACK_LABEL: Partial<Record<RecordType, string>> = {
  opportunity: 'Grants',
  notice: 'RFP',
}

const backLabelFor = (type: RecordType): string => BACK_LABEL[type] ?? TYPE_PLURAL_LABEL[type]

/** Human label for a snake_case field name, e.g. `last_verified` -> `Last verified`. */
function fieldLabel(name: string): string {
  const s = name.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function RelatedPanel({ groups }: { groups: RelatedGroup[] }) {
  return (
    <section className="card">
      <h2 className="card__title">Related records</h2>
      <div className="related">
        {groups.map((g) => (
          <div
            key={g.label}
            className="related__group"
            id={`related-${g.label.toLowerCase().replace(/\s+/g, '-')}`}
          >
            <h3 className="related__label">
              {g.label} <span className="related__count">({g.records.length})</span>
            </h3>
            {g.records.length === 0 ? (
              <p className="value value--absent">
                {g.emptyNote ?? 'Not recorded in the snapshot'}
              </p>
            ) : (
              <ul className="related__list">
                {g.records.map((r) => (
                  <li key={r.id}>
                    <Link to={pathForRecord(r.id) ?? '#'} className="related__link">
                      {r.id}
                    </Link>
                    <span className="related__name">{titleOf(r)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

interface RecordDetailPageProps {
  /** Param name from the route, e.g. `id`. */
  recordType: RecordType
  /** Builds the related-record groups from the importer's indexes. */
  related: (rec: RecordRow) => RelatedGroup[]
  /**
   * Optional content between the frontmatter fields and the related-record
   * panel. Used by detail pages that can say something derived about this
   * record — a Company summarising its bid pipeline, for instance.
   */
  above?: (rec: RecordRow) => ReactNode
  /**
   * Optional content rendered directly under the page header, before the
   * field list. Used by the Company intelligence view to lead with its
   * overview and section navigation rather than with raw frontmatter.
   */
  beforeFields?: (rec: RecordRow) => ReactNode
}

export default function RecordDetailPage({
  recordType,
  related,
  above,
  beforeFields,
}: RecordDetailPageProps) {
  const { id } = useParams<{ id: string }>()
  const rec = getRecord(id)

  if (!rec || rec.type !== recordType) {
    return (
      <section className="page">
        <h1 className="page__title">Record not found</h1>
        <div className="empty" role="alert">
          <p className="empty__headline">No {TYPE_LABEL[recordType].toLowerCase()} with ID “{id}”</p>
          <p className="empty__body">
            This ID is not present in the generated snapshot. The snapshot contains{' '}
            {getRecordCount(recordType)} {TYPE_LABEL[recordType].toLowerCase()}
            {getRecordCount(recordType) === 1 ? '' : 's'}. No record was created or guessed.
          </p>
          <p>
            <Link to={listPathFor(recordType)} className="btn">
              Back to {TYPE_PLURAL_LABEL[recordType]}
            </Link>
          </p>
        </div>
      </section>
    )
  }

  const schema = SCHEMAS[recordType]
  const frontmatter = rec.frontmatter as unknown as Record<string, unknown>

  return (
    <section className="page">
      <nav className="crumbs" aria-label="Back">
        <BackNavigation to={listPathFor(recordType)} label={backLabelFor(recordType)} />
      </nav>

      <header className="page__header">
        <h1 className="page__title">{titleOf(rec)}</h1>
        <p className="page__badges">
          <span className="idbadge">{rec.id}</span>
          {statusFieldsFor(schema.map((s) => s.name)).map(({ name, label }) => {
            const v = frontmatter[name]
            if (typeof v !== 'string' || v === '') return null
            return <StatusBadge key={name} label={v} title={label} />
          })}
        </p>
      </header>

      {beforeFields ? <div className="detail__intro">{beforeFields(rec)}</div> : null}

      <section className="card">
        <h2 className="card__title">Fields</h2>
        <p className="card__note">
          All {schema.length} fields as recorded. “Blank” means present but deliberately empty;
          “not recorded” means the key is absent. Nothing is inferred.
        </p>
        <dl className="fields">
          {schema.map((spec) => {
            const links = rec.links.fields[spec.name]
            const hasLinks = Array.isArray(links) && links.length > 0
            return (
              <div key={spec.name} className="fields__row">
                <dt className="fields__key">
                  {fieldLabel(spec.name)}
                  <span className="fields__raw">{spec.name}</span>
                </dt>
                <dd className="fields__value">
                  {hasLinks ? <WikilinkField links={links} /> : <ValueDisplay value={rfpDisplay(frontmatter[spec.name])} />}
                </dd>
              </div>
            )
          })}
        </dl>
      </section>

      {above ? <div className="detail__above">{above(rec)}</div> : null}

      <RelatedPanel groups={related(rec)} />

      <section className="card">
        <h2 className="card__title">Notes body</h2>
        <MarkdownBody body={rec.body} />
      </section>

      <section className="card card--muted">
        <h2 className="card__title">Provenance</h2>
        <dl className="fields fields--tight">
          <div className="fields__row">
            <dt className="fields__key">Source file</dt>
            <dd className="fields__value">
              <code>{rec.sourceFile}</code>
            </dd>
          </div>
          <div className="fields__row">
            <dt className="fields__key">Source SHA-256</dt>
            <dd className="fields__value">
              <code className="hash">{rec.sourceSha256}</code>
            </dd>
          </div>
        </dl>
      </section>
    </section>
  )
}

function getRecordCount(type: RecordType): number {
  return listRecords(COLLECTION_OF[type]).length
}
