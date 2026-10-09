# Phase 20C Report — Make Grants.gov Discovery Return Useful Real Results

Status: **Complete — real opportunities were retrieved and passed the open gate.**
A bounded live request through the existing Grants.gov bridge (broad `posted`
search, `rows=5`) returned **HTTP 200**, source-reported **hitCount 856**,
**5 retrieved**, **5/5 passed the open-opportunity gate** (all `posted`, future
close dates, official URLs, provenance). Live evidence is recorded below.

Timebox: exceeded while inspecting the real contract and correcting the
request/parse/normalization defects it exposed.

## Real API contract (observed live, Phase 20C)

`POST https://api.grants.gov/v1/api/search2` (no auth) accepts
`{ rows, oppStatuses, keyword?, startRecordNum? }`. A blank/omitted `keyword`
with `oppStatuses:"posted"` is a valid **broad search** (observed `hitCount`
856). Response: `{ errorcode, msg, data: { hitCount, oppHits: [...] } }`. The
real `oppHits` fields are `id`, `number`, `title`, `agencyCode`, **`agency`**,
`openDate`, `closeDate`, `oppStatus`, `docType`, `cfdaList`. Dates are published
**`MM/DD/YYYY`**.

## Defects found and corrected

1. **Agency never mapped.** The adapter read `agencyName`, which the real API
   does not return; every `issuingOrganization` was `null`. Now reads `agency`
   (fallback `agencyName` / `agencyCode`).
2. **Dates left as `MM/DD/YYYY`.** `normalizeGrantsGovDate` now converts the
   source format to ISO `YYYY-MM-DD` (ISO passthrough supported; unrecognized →
   `null`, never a guessed date).
3. **Blank keyword was an error and company-name substitution.** The bridge
   rejected blank keywords and the live store substituted the company name. Now
   a blank keyword is a broad `posted` search (see below).
4. **Default status filter included `forecasted`.** Default is now `posted`
   only, matching the open-opportunity goal.
5. **No pagination.** `adapterConfig.startRecordNum` is now honored and emitted
   as `startRecordNum` when > 0.

## What was implemented

- **Blank keyword = broad posted search** (`live-grantsgov-discovery.ts`,
  `grantsgov-bridge/handler.ts`, `grantsgov-adapter.ts`): no company-name
  substitution; the request omits `keyword`, sends `oppStatuses:"posted"`, a
  bounded `rows` (default 10, clamped 1–100), and optional `startRecordNum`.
  Company selection no longer restricts broad discovery; a provided keyword is
  used as a genuine opportunity search term and the selected company is
  preserved on every candidate for later matching.
- **Open-opportunity gate** (new `src/automation/grantsgov-gate.ts`): a record is
  Open (confirmed) ONLY when status is `posted`, the close date parses and is in
  the future relative to an explicit `now`, the URL is an official
  `https://www.grants.gov/search-results-detail/...`, and Grants.gov provenance
  (source id, record id, source name, observed-at) is present. Anything else is
  EXCLUDED with exact reasons. No inference, no eligibility claim.
- **UI** (`DiscoveryResults.tsx`, `DiscoveryControls.tsx`, `DiscoveryFilters.tsx`):
  Grants.gov candidates now show title (linked), agency, status, close date, the
  official Grants.gov link, and the gate verdict; each run shows
  `Retrieved · Open (passed gate) · Excluded` counts. The banner/notes and the
  keyword hint state the broad-search behavior; failure vs. successful
  zero-result is distinguished by the existing `emptyMessage`/outcome labels.

## Files changed

- **new** `src/automation/grantsgov-gate.ts` — deterministic open-opportunity gate.
- **new** `src/automation/grantsgov-gate.test.ts` — 5 gate tests.
- **edited** `src/automation/grantsgov-adapter.ts` — `agency` field, ISO date
  normalization, `posted` default, broad search, `startRecordNum`.
- **edited** `src/automation/grantsgov-adapter.test.ts` — real contract fixtures
  + broad/pagination tests.
- **edited** `src/live-source/grantsgov-bridge/handler.ts` — allow blank keyword
  as broad search.
- **edited** `src/live-source/grantsgov-bridge/handler.test.ts` — broad-search
  test; blank no longer rejected.
- **edited** `src/live-source/live-grantsgov-discovery.ts` — broad-search input,
  `posted` default, no company-name substitution, keyword filter only when set.
- **edited** `src/live-source/live-grantsgov-discovery.test.ts` — broad-search
  test + updated status expectations.
- **edited** `src/components/discovery/DiscoveryResults.tsx` — real opportunity
  detail + retrieved/open/excluded counts + gate verdicts.
- **edited** `src/components/discovery/DiscoveryControls.tsx`,
  `src/components/discovery/DiscoveryFilters.tsx` — truthful broad-search copy.
- **edited** `qa/funding-live.spec.ts`, `qa/ted-live.spec.ts` — updated for the
  real contract, gate UI, and broad-search copy.

## Hard boundaries honored

- Production Vault and `src/data/generated/opportunity-data.json` unchanged
  (md5 still `17cfae825e1de5320705b066effec15b`; fixture md5 still
  `06713f2dcc9a680301eea64e3013e32e`).
- No fixture/demo records used as live results.
- `SU-GRANTS-001` static registry entry NOT promoted to `AVAILABLE`.
- No stage/commit/push/clean; no new dependencies.

## Verification (exact commands and results)

| Command | Result |
|---|---|
| `npm run typecheck` (`tsc -b`) | clean |
| `npm run build` | succeeded (2.23s) |
| `npm run test:automation` | **325 passed / 0 failed** (was 319; +5 gate, +1 adapter) |
| `npm run test:live` | **79 passed / 0 failed** (was 77) |
| `npx playwright test qa/discovery.spec.ts qa/ted-live.spec.ts qa/funding-live.spec.ts` | **40 passed / 0 failed** |
| `npm run test:qa` (full suite) | **366 passed / 3 skipped / 0 failed** (4.8m) |

Offline coverage added: blank-keyword broad search (bridge, store, adapter),
keyword search, real response shape (agency/date parsing), pagination, gate
pass/exclude cases, empty vs error. All tests offline (stubs / `page.route`).

### Live evidence (one bounded read-only request through the bridge)

```
POST http://localhost:4173/__tvb/grantsgov/search
{"runId":"RUN-G-LIVE20C","companyId":"BROAD","keyword":"","oppStatuses":"posted","limit":5,
 "requestedAt":"2026-10-09T00:00:00.000Z"}
```

- HTTP outcome: **200**; bridge envelope `ok:true`, source `status:200`.
- API-reported hit count: **856**.
- Retrieved (bounded `rows=5`): **5**; parse errors: **0**.
- Passed the open gate: **5 / 5** (all `posted`, future close dates, official
  URLs, provenance).
- Sanitized examples (id / title / agency / status / closeDate / official URL):
  - `357305` / "Feasibility Clinical Trials of Mind and Body Interventions for NCCIH High Priority Research Topics (R34 Clinical Trial Required)" / National Institutes of Health / posted / 2026-11-17 / https://www.grants.gov/search-results-detail/357305
  - `357303` / "Investigator Initiated Clinical Trials of Complementary and Integrative Interventions Delivered Remotely or via mHealth (R01 Clinical Trial Required)" / National Institutes of Health / posted / 2026-11-17 / https://www.grants.gov/search-results-detail/357303
  - `357658` / "Limited Competition: Small Grant Program for the NCATS Clinical and Translational Science Award (CTSA) Program (R03 Clinical Trial Optional)" / National Institutes of Health / posted / 2026-10-19 / https://www.grants.gov/search-results-detail/357658
  - `356893` / "Dissemination and Implementation Research in Health (R01 Clinical Trial Optional)" / National Institutes of Health / posted / 2028-01-07 / https://www.grants.gov/search-results-detail/356893
  - `356920` / "Dissemination and Implementation Research in Health (R21 Clinical Trial Optional)" / National Institutes of Health / posted / 2028-01-07 / https://www.grants.gov/search-results-detail/356920

No secrets were logged; only ids/titles/agencies/dates/official URLs are recorded,
not full API responses.

## Explicit outcome

- **Real opportunities WERE retrieved** (5 bounded records; source reports 856
  matching posted opportunities).
- **Records DID pass the open-opportunity gate** (5/5).

## Unfinished / next

- Full `npm run test:qa` suite now re-run post-timebox: **366 passed / 3
  skipped / 0 failed** (3 skips are pre-existing `test.skip`s, e.g. BUG-1).
- Broad search is per selected company today (each company issues the same broad
  query and the same opportunities are shown per company run). A future phase may
  run one broad search and match companies to it.
- Confirm the endpoint's rate-limit/fair-use terms; global promotion of
  `SU-GRANTS-001` still requires a recorded verified live query.
