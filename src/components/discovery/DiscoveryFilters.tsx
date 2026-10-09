import type { DiscoveryLocation, DiscoverySector } from '../../automation/discovery-fixture'
import { LOCATION_OPTIONS, SECTOR_OPTIONS } from './labels'

interface DiscoveryFiltersProps {
  sector: DiscoverySector
  keyword: string
  location: DiscoveryLocation
  onSectorChange(sector: DiscoverySector): void
  onKeywordChange(keyword: string): void
  onLocationChange(location: DiscoveryLocation): void
}

/**
 * Optional Phase H run filters (Phase H brief §2–§5).
 *
 * Sector and location are fixed deterministic vocabularies; keyword is free
 * text (trimmed by the store). For a live search the keyword becomes the
 * source search term for every selected company; when it is blank the live
 * store substitutes each company's own name as the search term (it is NOT an
 * empty filter). The panel records the selection on the discovery request and
 * shows it in the run summary — it performs no real filtering of its own.
 */
export default function DiscoveryFilters({
  sector,
  keyword,
  location,
  onSectorChange,
  onKeywordChange,
  onLocationChange,
}: DiscoveryFiltersProps) {
  return (
    <fieldset className="dg-fieldset">
      <legend className="dg-legend">Refine the run</legend>
      <div className="dg-filters">
        <div className="dg-filter">
          <label className="dg-filter__label" htmlFor="dg-sector">
            Sector / Category
          </label>
          <select
            id="dg-sector"
            className="dg-filter__control"
            value={sector}
            onChange={(event) => onSectorChange(event.target.value as DiscoverySector)}
          >
            {SECTOR_OPTIONS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="dg-filter">
          <label className="dg-filter__label" htmlFor="dg-keyword">
            Keyword
          </label>
          <input
            id="dg-keyword"
            className="dg-filter__control"
            type="text"
            value={keyword}
            placeholder="e.g. bridge"
            autoComplete="off"
            aria-describedby="dg-keyword-hint"
            onChange={(event) => onKeywordChange(event.target.value)}
          />
          <p id="dg-keyword-hint" className="dg-filter__hint">
            Live searches send this term to the source. Leave it blank and Live TED searches each company&rsquo;s name; Live Funding runs a broad posted-opportunity search.
          </p>
        </div>
        <div className="dg-filter">
          <label className="dg-filter__label" htmlFor="dg-location">
            Location
          </label>
          <select
            id="dg-location"
            className="dg-filter__control"
            value={location}
            onChange={(event) => onLocationChange(event.target.value as DiscoveryLocation)}
          >
            {LOCATION_OPTIONS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </fieldset>
  )
}
