# Phase 21B Report — Pin EU Opportunity Classification Contract

Status: **Classification contract pinned for the SEDIA database.** The official
**FACET API** translated the reference codes, so grant vs tender vs
cascade-funding vs FAQ is now decidable for records from the `SEDIA` database.
Unknowns remain for non-SEDIA databases and two status codes (see below).

Diagnostic only — **no code or adapter was written**, no snapshot/Vault change,
no staging/commits.

## Official documentation references

- Portal APIs page (official):
  https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/support/apis
  - Documents the **SEARCH API**:
    `https://api.tech.ec.europa.eu/search-api/prod/rest/search?apiKey=SEDIA&text=***`
  - Documents the **FACET API** ("to get description of reference data code"):
    `https://api.tech.ec.europa.eu/search-api/prod/rest/facet?apiKey=SEDIA&text=***`
  - States both take the **same `query` form-data part**.
  - Official worked query examples:
    - "only call for Tenders": `{"bool":{"must":[{"terms":{"type":["0"]}},{"terms":{"status":["31094501","31094502","31094503"]}}]}}`
    - "All grants and Tenders": `{"bool":{"must":[{"terms":{"type":["0","1","2","8"]}},{"terms":{"status":["31094501","31094502","31094503"]}}]}}`
    - "only open tenders": `type ["0"]`, `status ["31094501","31094502"]`
  - Official note: *"Reference codes for example for the Status of the Call
    (Open, Close, Forthcoming) look like these: 31094501, 31094502, 31094503"*.
- Corroborating third-party (not authoritative, used only to frame known
  practitioner gaps): EMDESK "EU Funding & Tenders Portal API" guide
  (https://www.emdesk.com/horizon-2020-horizon-europe-basics-guide/eu-funding-tenders-portal-api-guide)
  — anonymous read access; full topic descriptions are not always returned by
  the search API; TED is the procurement system.

## FACET endpoint — verified shape

- Endpoint: `POST https://api.tech.ec.europa.eu/search-api/prod/rest/facet?apiKey=SEDIA&text=*`
- Access: **public, no auth**; same HTTP headers as the Search API (Chrome
  `User-Agent`, `Referer`/`Origin` = ec.europa.eu, `Accept: application/json…`).
- Request body: same three `multipart/form-data` parts as the Search API —
  `query` (`application/json`, Elasticsearch `bool`), `languages` (`["en"]`),
  `displayLanguage` (`en`).
- Response schema (observed): `{ apiVersion, terms, facets[] }` where each
  facet is `{ apiVersion, name, rawName, database, count, values[] }` and each
  value is `{ apiVersion, rawValue, value (human label), count }`.

### The one additional bounded request (per the mission's allowance)

- Request: `POST /rest/facet?apiKey=SEDIA&text=*` with
  `query = {"bool":{"must":[{"terms":{"type":["0","1","2","8"]}},{"terms":{"status":["31094501","31094502","31094503"]}}]}}`
- Outcome: **HTTP 200**; 39 facet groups returned. No retries.

## Verified field/code mappings (authoritative — from FACET)

### `type` facet (`database: SEDIA`)

| rawValue | label (official) | count |
|---|---|---|
| `0` | **Tender** | 25152 |
| `1` | **Grant** | 17647 |
| `8` | **Cascade funding calls** | 1660 |
| `2` | **Calls for proposals** | 20 |

### `status` facet (`database: SEDIA`)

| rawValue | label (official) | count |
|---|---|---|
| `31094501` | **Forthcoming** | 1142 |
| `31094502` | **Open for submission** | 1501 |
| `31094503` | **Closed** | 41836 |

### Document-type / datasource discrimination (from Search API, Phase 21A)

- `metadata.DATASOURCE: ["SEDIA_FAQ"]` → **FAQ / documentation** records (must
  be excluded; they dominate unfiltered free-text search).
- `metadata.DATASOURCE: ["SEDIA"]` and `["SEDIA_PRD_CENTRICITY"]` → opportunity
  records. `SEDIA_PRD_CENTRICITY` appears to be a centroid index (21A returned
  the same `reference` twice, once per datasource) → dedupe by `reference`.

## Classification rules (explicit; unknowns stay unknown)

Classify by **(`DATASOURCE`/database) + `type`**, never by `type` alone:

1. `DATASOURCE` includes `SEDIA_FAQ` → `FAQ_DOCUMENT`.
2. Otherwise, if the record is from the **`SEDIA`** database:
   - `type:["0"]` → `TENDER` (public procurement / call for tenders).
   - `type:["1"]` → `GRANT_TOPIC` (call for proposals / topic).
   - `type:["8"]` → `CASCADE_FUNDING_CALL`.
   - `type:["2"]` → `EXTERNAL_ACTION_GRANT` (a call-for-proposals grant family
     surfaced from external-action programmes; NOT a tender).
   - Any other/absent `type` → `UNKNOWN`.
3. Record from **any non-`SEDIA` database** (e.g. PROSPECTS external actions
   seen in 21A request 3) → `UNKNOWN`/`EXTERNAL_ACTION`; the SEDIA `type`
   mapping does **not** apply and must not be used to infer a tender.
4. **Never** infer `TENDER` from `type:2` (Phase 21A showed `type:2` returns
   external-action grant schemes such as *"Town Twinning between Turkey and
   EU-II … Grant Scheme (TTGS-II)"*, not tenders). Tenders are `type 0` in the
   SEDIA database.

### Lifecycle / deadline representation

- Lifecycle is the numeric `metadata.status[]` code. Known: `31094501`
  Forthcoming, `31094502` Open for submission, `31094503` Closed. These are
  **evidence**, not a TVB "open/eligible" verdict.
- `metadata.deadlineDate[]` holds ISO timestamps, e.g.
  `2027-09-15T00:00:00.000+0000` (multi-stage calls may carry several deadline
  entries; some records expose a single value). Publication/order date is
  `metadata.es_SortDate[]`. Carry both verbatim; do not synthesize a deadline
  when absent.
- **Unknown status codes must remain unknown:** `310945031` and `99999998`
  were observed in 21A on external-action/tender records and are **not** in the
  SEDIA status facet; do not map them to Open/Closed without a facet that
  defines them.

## Stable IDs and official URLs

- **Stable id:** `reference` (per-record, stable). Human-stable call id:
  `metadata.callIdentifier[]`. Topic id appears in the portal URL; tender
  procedure id appears as `metadata.esST_procedureId[]`.
- **Official URLs observed:**
  - Grant/topic (modern):
    `https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/<TOPIC-ID>`
  - Grant/topic (older H2020 records the `url` field points at a data endpoint):
    `.../opportunities/data/topicDetails/<CALLID>.json`
  - Tender: `.../opportunities/portal/screen/opportunities/tender-details/<procedureId>`
    and PROSPECTS: `https://webgate.ec.europa.eu/prospect/external/publishedcalls.htm?callId=<id>`
- Each result carries its own `url`; prefer it, and additionally keep
  `callIdentifier`/`esST_procedureId` for a canonical portal link when needed.

## Sanitized response examples (from Phase 21A evidence)

Grant/topic (SEDIA, `type:["1"]`, `status:31094501` Forthcoming):

```
reference : 50142710TOPICSen
title     : Artificial Intelligence for Cybersecurity applications
callId    : HORIZON-CL3-2027-02-CS-ECCC
status    : 31094501 (Forthcoming)
deadline  : 2027-09-15T00:00:00.000+0000
DATASOURCE: ["SEDIA"]
url       : .../opportunities/topic-details/HORIZON-CL3-2027-02-CS-ECCC-01
```

Grant/topic (SEDIA, `type:["1"]`, `status:31094503` Closed):

```
reference : 31115283Innovationaction1574121600000
title     : Artificial Intelligence on demand platform
callId    : H2020-ICT-2018-20
status    : 31094503 (Closed)
deadline  : 2020-06-17T17:00:00.000+0000
DATASOURCE: ["SEDIA","SEDIA_PRD_CENTRICITY"]  (same reference, centroid duplicate)
```

External-action grant scheme (21A `type:["2"]`, NOT a tender — do not label tender):

```
reference : 181971PROSPECTSEN
title     : Appui à la Gestion des Aires Protégées … (Gabon)
callId    : 181971
status    : 99999998 (UNKNOWN — not in SEDIA status facet)
DATASOURCE: ["SEDIA"]
url       : https://webgate.ec.europa.eu/prospect/external/publishedcalls.htm?callId=181971
```

FAQ/documentation (excluded):

```
DATASOURCE: ["SEDIA_FAQ"]   e.g. reference 78109 — an FAQ answer, not an opportunity
```

No tender (`type:0`) record was captured in 21A; tender classification rests on
the official FACET label (`type 0 = Tender`, 25152 rows) and the official
"only call for Tenders" query. A sanitized `type:0` example should be captured
when the adapter is built.

## Remaining unknowns

1. `type:8` label is "Cascade funding calls" — confirm its lifecycle/deadline
   field set (assumed same `status`/`deadlineDate`).
2. `type` codes are **database-scoped**; the 21A `type:2` search returned 3942
   rows while the SEDIA facet counts only 20 → non-SEDIA databases reuse `type`
   with different meaning. Database/datasource must gate the mapping.
3. Status `310945031` and `99999998` are undefined in the SEDIA facet — map
   only if a facet that defines them is found.
4. Whether TED-sourced tenders and PROSPECTS tenders both surface as `type:0`
   in `SEDIA`, or require a separate datasource/ted query, is unconfirmed.
5. `SEDIA_PRD_CENTRICITY` vs `SEDIA` duplication — confirm centroid dedupe key
   (`reference` vs `callIdentifier`).

## Minimal implementation plan (no code this phase)

1. Adapter `src/automation/eu-sedia-adapter.ts`:
   - parse `results[].metadata` (arrays; take first element);
   - classify via rule set above keyed on `DATASOURCE` + `type`, defaulting to
     `UNKNOWN`;
   - normalize: `reference` → `sourceRecordId`; `url` → `sourceUrl`; `title[0]`
     → title; `callIdentifier[0]`; `es_SortDate[0]` → publicationDate;
     `deadlineDate[0]` → deadline; raw `status[0]` + raw `type[0]` +
     `DATASOURCE[0]` carried as **evidence** fields (never an open verdict).
2. Bridge `/__tvb/eu/search` reusing `createFetchTransport` + the shared
   `dispatchBridgeRequest` boundary; build the `multipart/form-data` body with
   the fixed endpoint server-side; require the documented headers server-side.
3. Default query: `type ["1","8"]` + `status ["31094501","31094502"]` (grants +
   cascade, forthcoming/open) with `must_not DATASOURCE ["SEDIA_FAQ"]`;
   tenders gated behind an explicit `type ["0"]` option, clearly separated.
4. Offline tests from a sanitized fixture built from the three examples above;
   assert: FAQ excluded, `type:2` classified as external-action grant (not
   tender), unknown `type` → UNKNOWN, unknown status stays unknown.

## Recommendation on tenders

The **grant/topic + cascade-funding subset is fully verified** and can be built
now (classification, status, deadline, URL, stable id all pinned). **Tender
classification is documented** (`type:0 = Tender` in SEDIA) but not yet
evidenced by a captured `type:0` record, and status codes `310945031`/
`99999998` remain unmapped — proceed with the verified grant-topic subset
separately and capture a live `type:0` example before enabling tenders.

## Boundaries honored

- No code, registry, UI, Vault, or snapshot changes.
- One bounded read-only FACET request (plus reuse of Phase 21A evidence); no
  retries, scrapes, or access-control bypass.
- No fabricated data; raw responses stayed in local temp files.
- No staging, commits, or unrelated work.
