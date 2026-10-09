# Funding Discovery Audit — Open Opportunities

**Date:** 2026-10-09 · **Type:** diagnostic only · **Timebox:** 20 minutes
**Status:** Complete. **No code, tests, Vault, or generated data were changed.**

## How to read this document

Every statement is tagged with its evidence class:

- **[CONFIRMED]** — verified directly in this repository (source read, recorded
  fixture, or existing test) during this audit.
- **[HISTORICAL]** — evidence captured by an earlier phase (report/fixture),
  reused here; not re-executed.
- **[RECOMMENDATION]** — proposed action, not yet implemented.
- **[UNVERIFIED]** — assumption or open question that needs confirmation.

---

## 1. Current funding workflow (traced)

### 1.1 Path

`src/pages/Discovery.tsx:150-194` (`runLiveFundingDiscovery`) →
`src/live-source/live-funding-discovery.ts` (`liveUsaSpendingDiscoveryStore`) →
same-origin bridge `POST /__tvb/usaspending/search`
(`src/live-source/usaspending-bridge/contract.ts:17`) →
`src/live-source/usaspending-bridge/handler.ts` →
`src/automation/usaspending-adapter.ts` → orchestrator → Phase E review queue →
`src/components/discovery/DiscoveryResults.tsx`.

- One read-only POST per selected company to
  `https://api.usaspending.gov/api/v2/search/spending_by_award/`
  (`usaspending-adapter.ts:43`). No login, no API key. **[CONFIRMED]**
- Keyword blank ⇒ the company name becomes the search term
  (`live-funding-discovery.ts:152-154`, mirrors TED). **[CONFIRMED]**
- Window: `publishedSince = today − 365d` (`USA_LIVE_WINDOW_DAYS = 365`,
  `live-funding-discovery.ts:44,224`); end date derived from `requestedAt`.
  **[CONFIRMED]**
- Filter: `award_type_codes: ['02']` (grants) + full-text `keywords`
  (`usaspending-adapter.ts:99-115`). `sector`/`location`/`exclusions` are **not
  supported** and surface as warnings (`usaspending-adapter.ts:131-141`).
  **[CONFIRMED]**

### 1.2 What each registered source can actually return

| Source ID | Domain | Applicability | Real? | Returns | Evidence |
|---|---|---|---|---|---|
| `SU-US-001` USAspending | funding | funding | yes | **Obligated public-assistance award records** (`award_type_code 02`) — historical awards, no deadline, no open/closed status | `registry.ts:172-186`; `usaspending-adapter.ts:2-8,285-303` **[CONFIRMED]** |
| `SU-TED-001` TED | procurement | procurement | yes | EU/EEA **procurement notices** (tenders), not grants | `registry.ts:157-171` **[CONFIRMED]** |
| `SU-GT-001` GlobalTenders | procurement | procurement | no | metadata only; `accessState: UNKNOWN`, never queried | `registry.ts:122-134` **[CONFIRMED]** |
| `SU-FX-001/002` fixture | both | both | no | local deterministic fixtures | `registry.ts:135-156` **[CONFIRMED]** |

**No funding-domain source returns open application opportunities.**
USAspending is the only real funding source, and its own registry note states it
is "Grant award records (obligated public assistance awards), not open-call
solicitation notices" (`registry.ts:183`). **[CONFIRMED]**

### 1.3 The candidate record cannot represent "open"

`parseUsaSpendingBody` always sets `deadline: null`, `rawType: 'grant_award'`,
and `sourceUrl` to the **award profile page**
`https://www.usaspending.gov/award/<id>?tab=overview`
(`usaspending-adapter.ts:285-303`; `USA_SPENDING_AWARD_PREFIX` at `:46`).
**[CONFIRMED]** There is no open/closed/upcoming status field, no application
URL, no closing date anywhere in the funding path. A repo-wide search for
open/expired/status gating found only a UI dropdown (`FilterBar.tsx`) — the
pipeline never checks deadlines (`normalize.ts:186,233,245` only *normalizes* a
deadline, if one existed). **[CONFIRMED]**

### 1.4 UI is already honest about this

`DiscoveryResults.tsx:90-97,111-112` labels live funding results
"US federal awards, not open grant solicitations" and "obligated grants, not
open grant solicitations". **[CONFIRMED]** So the product is not lying — but it
also confirms the objective ("actionable grants companies can currently apply
for") is not what this source produces.

---

## 2. USAspending zero-result investigation

**Question:** were the Phase 17 zero results an integration defect or expected?

### 2.1 Evidence compared

| Query | Date range | Keyword | Result | Evidence |
|---|---|---|---|---|
| Recorded "success" | **none sent** (old `verify-live-funding.ts` hardcodes `publishedSince: ''`) | `solar energy` | 3 awards, all **2009** ARRA/Recovery projects | `usaspending-fixture.ts:1-11` **[HISTORICAL]** |
| Phase 17 live run | `2025-10-09` → `2026-10-09` (365 d) | `solar energy` | HTTP 200, **0** results, honest `NO_RESULTS` | `qa/phase17-report.md:42-62` **[HISTORICAL]** |
| Phase 16A offline | both bounds present | — | fixes prior HTTP 422 | `qa/phase16a-report.md` **[HISTORICAL]** |

### 2.2 Findings

- **[CONFIRMED] The date fix is correct and not the cause.** The live request now
  returns HTTP 200 (was 422 for a missing `end_date`); an empty 200 is the only
  legitimate path to `NO_RESULTS`. The bounded `time_period` is being accepted.
- **[CONFIRMED] Zero recent results are expected for this source, not a defect.**
  The recorded response proves the keyword `solar energy` matches old
  description text (2009 awards), so a 365-day window correctly excludes them.
  USAspending indexes **award history**; "solar energy" grants in the last 12
  months may simply not exist, and even if they did they would be obligated
  awards, not open applications.
- **[CONFIRMED] The deeper root cause is semantic, not technical:** a successful
  USAspending search cannot yield an actionable open grant. Sorting by
  `Start Date desc` on award history surfaces obligations, not solicitations.
- **[CONFIRMED] No normalization bug was found.** The parser maps only fields
  the source provides; missing fields stay `null` (`adapter.ts` contract). The
  zero-result path is clean.

**Conclusion:** the zero results are *honest and expected*. "Fixing" them by
widening the window or loosening filters would at best surface more historical
awards — which is explicitly not the goal.

---

## 3. Audit of official open-grant sources

### 3.1 Existing Grants.gov integration attempts

**[CONFIRMED] None exist.** A repository-wide search for `grants.gov` /
`grantsgov` across `src/`, `server/`, `qa/`, docs, and `.vault-snapshot/`
returned **no integration code, endpoint, adapter, or error log**. There is
therefore no "Grants.gov error" to fix; funding discovery has simply never been
pointed at an open-opportunity source.

### 3.2 Official Grants.gov access routes (verified from official docs)

Two official, government-operated options exist. Both are read-only search APIs;
neither requires bypassing any access control.

**Option A — classic Grants.gov API (`search2` / `fetchOpportunity`).**
**[VERIFIED — official docs `https://www.grants.gov/api/common/search2` and
`https://www.grants.gov/api/api-guide`]**

- Production base: `https://api.grants.gov`; staging:
  `https://api.staging.grants.gov`.
- `POST https://api.grants.gov/v1/api/search2` — **authentication and
  authorization are NOT required** (the API guide lists `search2` and
  `fetchOpportunity` under "Authentication and authorization are not required").
- Request body keys (from the official request sample): `rows`, `keyword`,
  `oppNum`, `eligibilities`, `agencies`, `oppStatuses` (e.g.
  `"forecasted|posted"`), `aln`, `fundingCategories`, `fundingInstruments`,
  `startRecordNum`, `sortBy`.
- Response shape: `{ errorcode, msg, data: { hitCount, startRecord, oppHits:
  [{ id, number, title, agencyCode, agencyName, openDate, closeDate,
  oppStatus, docType, alnist }], oppStatusOptions, dateRangeOptions,
  eligibilities, fundingCategories, fundingInstruments, ... } }`.
- `oppStatus` values are `posted | forecasted | closed | archived`;
  `closeDate` is the deadline. `POST .../fetchOpportunity` returns the full
  detail record (eligibility, award floor/ceiling, description).
- Other endpoints (e.g. "Opportunity Totals by CFDA") **require an API key**
  obtained from the Grants.gov Help Desk (a normal credential, not a bypass).

**Option B — Simpler.Grants.gov API (the newer replacement).**
**[VERIFIED — official wiki
`https://wiki.simpler.grants.gov/product/api/search-opportunities`]**

- `POST https://api.simpler.grants.gov/v1/opportunities/search`, header
  `X-API-Key: <key>`, `Content-Type: application/json`. **Requires an API key.**
- Body: `query`, `query_operator` (`AND`/`OR`), `filters` (e.g.
  `opportunity_status.one_of: ["posted","forecasted"]`, `funding_instrument`,
  `funding_category`, `top_level_agency`, eligibility), `pagination`
  (`page_offset`, `page_size`, `sort_order`).
- Detail: `GET /v1/opportunities/{opportunity_id}` (UUID); supports `?format=csv`.
- Caveat documented by the source: search returns at most 10,000 opportunities
  and is cached hourly.

**[RECOMMENDATION]** Prefer **Option A (`search2` + `fetchOpportunity`)** for a
first integration because it needs **no credential** (matches this project's
"no key, no login" source philosophy, like TED and USAspending), and it exposes
exactly the status/deadline fields the opportunity contract needs. Add Option B
later if richer filtering or CSV export is required (it needs an API key).

**[UNVERIFIED]** Exact `search2` rate limits / fair-use terms (referenced by the
API Terms & Conditions page but not read in full here). Confirm before building.

### 3.3 What the sources can and cannot provide

| Capability | USAspending (current) | Grants.gov `search2` (proposed) |
|---|---|---|
| Open/forecasted/closed status | ✗ | ✓ `oppStatus` |
| Closing date / deadline | ✗ (`null`) | ✓ `closeDate`, `dateRangeOptions` |
| Application URL | ✗ (award profile only) | ✓ opportunity number → official detail |
| Eligibility | ✗ | ✓ via `fetchOpportunity` / `eligibilities` |
| Funding range | partial (`Award Amount`, obligated) | ✓ award floor/ceiling |
| Award *history* | ✓ (its whole purpose) | ✗ (not its purpose) |
| Auth required | none | none for `search2`/`fetchOpportunity` |
| **Fit for "apply now"** | **No** | **Yes** |

---

## 4. Required opportunity contract

**[RECOMMENDATION]** Introduce a canonical **OpenOpportunity** record, additive
to the existing candidate pipeline, that can only be populated from a source
that officially publishes open/forecasted opportunities. It aligns with the
already-defined vault schema (`OPP-003` fields: `application_url`,
`application_open_date`, `application_deadline`, `deadline_type`,
`eligibility_summary`, `amount_min/max`, `verification_status`, `last_verified`,
`record_status`) — reuse those names for consistency.

Proposed fields (all optional unless a rule requires them):

| Field | Notes |
|---|---|
| `sourceId` | stable, e.g. a new `SU-GRANTS-001` registry entry |
| `opportunityId` | source-stable ID (Grants.gov `number`, e.g. `USDA-NIFA-...`) |
| `officialApplicationUrl` | the source's own detail/apply URL — **required** |
| `title`, `agency` (`agencyName`) | from source |
| `status` | `open \| forecasted \| closed \| archived \| unknown` (Grants.gov `oppStatus`) |
| `postedDate`, `closeDate`, `closeTimeZone` | Grants.gov `openDate`/`closeDate`; timezone only if published |
| `eligibilityRequirements`, `eligibilityGeography` | from `fetchOpportunity` |
| `fundingInstrument` | grant / cooperative agreement |
| `fundingCategories` | Grants.gov `fundingCategories` |
| `awardMin`, `awardMax`, `currency` | only when officially published (may be null/`$--`) |
| `lastVerifiedAt` + `rawProvenance` | existing provenance contract |
| `eligibilityConfirmed` vs `inferredRelevance` | **explicitly separate** fields; per-company fit is INHERED relevance, never "confirmed eligible" |

### 4.1 Rules preventing bad records being shown as "open"

**[RECOMMENDATION]** A record may be presented as a currently-open opportunity
**only if all** hold:

1. `status === 'open'` (or `forecasted` shown as "upcoming", never as "open").
2. `closeDate` is present and `> now` (evaluated in the source's timezone if
   given; otherwise UTC with a visible warning). Missing/blank close date ⇒
   **unknown**, shown as "rolling/deadline not published", never "open".
3 **Provenance is real**: `sourceId` is registered with `accessState:
   AVAILABLE` and a recorded fetch; no fixture records on a live path.
4. **Not award-history-only**: `rawType` in the opportunity vocabulary
   (`*_opportunity`), never `grant_award`.
5. **Deduplicated** on `(sourceId, opportunityId)` (reuse `dedup.ts`).
6. **Eligibility honesty**: `eligibilityConfirmed` is only ever set from a
   source-published eligibility field; anything derived from the company profile
   is `inferredRelevance`, displayed separately.

Expired (`closeDate <= now`), archived, and award-history records are stored (if
at all) as **history/context**, never in the "open opportunities" list.

---

## 5. Minimum safe implementation plan

**[RECOMMENDATION]** Smallest evidence-backed path, mirroring the existing TED /
USAspending bridge pattern so no new architecture is introduced.

1. **Registry** (`registry.ts`): add `GRANTS_GOV_SOURCE_ID = 'SU-GRANTS-001'`,
   `applicability: 'funding'`, `accessState: 'AVAILABLE'` **only after** a
   verified read-only `search2` call, with the same honesty notes as TED/US.
2. **Adapter** (`src/automation/grantsgov-adapter.ts`): pure module like
   `usaspending-adapter.ts`. `buildGrantsGovQueryPlan` maps keyword →
   `{ keyword, oppStatuses: 'posted' (and optionally 'forecasted'),
   rows: limit }`. `parseGrantsGovBody` maps `data.oppHits` → `RawResult`:
   `deadline = closeDate`, `rawType` = opportunity type, `sourceUrl` = official
   opportunity detail URL, `issuingOrganization = agencyName`. Preserve the
   "never invent" rules and the FAILED-vs-empty distinction.
3. **Bridge** (`src/live-source/grantsgov-bridge/`): clone the USAspending
   bridge (contract + handler + plugin) with fixed endpoint
   `https://api.grants.gov/v1/api/search2`; one read-only POST; no body fields
   reach the source except discovery parameters.
4. **Live store** (`live-grantsgov-discovery.ts`): clone
   `live-funding-discovery.ts`. Replace the 365-day "recency" window with
   **status + close-date** semantics (`oppStatuses: posted`, close date in the
   future).
5. **Presentation** (`DiscoveryResults.tsx`): show `status`, `closeDate`,
   `agency`, `officialApplicationUrl`, and separate "confirmed eligibility" vs
   "inferred relevance". Reuse the Phase 18 empty-vs-failed messaging.
6. **Do not remove USAspending** — reclassify it honestly as "US federal award
   history (obligated awards)", useful for context/verification, not for
   application opportunities.

### 5.1 Tests (deterministic, offline)

- Adapter tests with a **byte-for-byte recorded** `search2` response (like
  `usaspending-fixture.ts`): parse, status mapping, deadline mapping, empty vs
  failure, key cap, warnings for unsupported filters.
- Contract rules: expired `closeDate` never appears in the open list; missing
  `closeDate` ⇒ "unknown", not "open"; `forecasted` labeled "upcoming";
  award-history (`grant_award`) excluded from open opportunities.
- Reuse `dedup`/`normalize` tests; bridge handler tests mirroring
  `usaspending-bridge/handler.test.ts`.
- One Playwright offline spec intercepting `/__tvb/grantsgov/search`.

---

## 6. Unresolved questions and risks

- **[UNVERIFIED]** `search2` pagination/rate-limit details and fair-use terms —
  read the API Terms & Conditions before implementing.
- **[UNVERIFIED]** `search2` may be a legacy endpoint given Simpler.Grants.gov;
  confirm its deprecation policy and whether `api.grants.gov/v1/api/search2`
  remains supported.
- **[UNVERIFIED]** Grants.gov `openedDate`/`closeDate` timezone handling.
- **Risk:** a company-name keyword may match few/zero open opportunities
  (same class of empty result as Phase 17). Mitigation: the Phase 18 empty
  messaging plus a suggestion to enter a sector keyword; never widen silently.
- **Risk:** eligibility is agency-defined and complex; the "confirmed vs
  inferred" split must be enforced in code, not prose.
- **Risk:** scope creep into applications/proposals. This audit and the plan
  stop at *discovery*; no applications are created.

---

## Confirmed root cause (summary)

Funding discovery produces no actionable open grants because **the only real
funding source wired in (USAspending) publishes obligated award history, not
open solicitations**, and the pipeline has **no status/deadline/application-URL
concept** for funding. The Phase 17 zero results were an honest, expected
consequence — not an integration defect. The missing piece is an official
**open-opportunity** source; Grants.gov's `search2`/`fetchOpportunity` APIs are
the verified, no-authentication path to supply it.
