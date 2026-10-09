# Phase 21A Report — Verify EU Funding & Tenders Live Results

Status: **Verification successful — genuine records retrieved from the official
source.** The documented EU Funding & Tenders Portal **Search API** returned real
grant/topic records over HTTP 200. Per the mission's timebox rule ("if
implementation cannot safely fit the timebox, stop after the live-source
verification and document the exact next step"), **no adapter or UI code was
written** — the timebox did not permit a safe implementation. No repository code
was changed; no automated tests were affected.

## Source and documented contract

- Official API page: https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/support/apis
- Endpoint (documented): `https://api.tech.ec.europa.eu/search-api/prod/rest/search?apiKey=SEDIA&text=***`
- Method: **HTTPS POST**, public/no auth; `apiKey=SEDIA` selects the main portal
  index (calls for tenders, topics, grants).
- URL params used: `apiKey`, `text`, `pageSize`, `pageNumber`, `sortBy`, `orderBy`.
- Body: **`multipart/form-data`** with exactly three parts —
  `query` (`application/json`, an Elasticsearch `bool` query),
  `languages` (`["en"]`), `displayLanguage` (`en`).
- The API guards basic scraping with headers; the requests sent
  `User-Agent` (Chrome), `Referer: https://ec.europa.eu/info/funding-tenders/opportunities/portal/`,
  `Origin: https://ec.europa.eu`, `Accept: application/json, text/plain, */*`.

## Bounded read-only requests (3 total — no retries, no loops)

All requests were single, bounded (`-m 30`, `pageSize` ≤ 10). Full raw responses
were captured only to a local temp file during inspection and are **not**
committed.

### Request 1 — broad text query (`artificial intelligence`)

- Outcome: **HTTP 200**; `totalResults: 24550`; returned 10.
- **Finding:** the unfiltered free-text search is dominated by FAQ documents
  (`metadata.DATASOURCE: ["SEDIA_FAQ"]`) — **not** calls/tenders. A successful
  HTTP status alone was **not** treated as proof of valid results.

### Request 2 — grants/topics (type filter, FAQ excluded) — real records

- Body `query`: `{"bool":{"must":[{"terms":{"type":["1","2","8"]}}],"must_not":[{"terms":{"DATASOURCE":["SEDIA_FAQ"]}}]}}`
- Outcome: **HTTP 200**; `totalResults: 2541`; returned 10, all `type:["1"]`.
- `DATASOURCE` values: `SEDIA_PRD_CENTRICITY` (6), `SEDIA` (4).
- `status` codes: `31094501` (1), `31094503` (9).
- Sanitized evidence (reference / title / callIdentifier / status / deadline / official URL):

| reference | title | callIdentifier | status | deadline | url |
|---|---|---|---|---|---|
| 50142710TOPICSen | Artificial Intelligence for Cybersecurity applications | HORIZON-CL3-2027-02-CS-ECCC | 31094501 | 2027-09-15 | `.../opportunities/topic-details/HORIZON-CL3-2027-02-CS-ECCC-01` |
| 31088389ResearchandInnovationaction1509408000000 | Artificial Intelligence | H2020-ICT-2018-20 | 31094503 | 2018-04-17 | `.../data/topicDetails/ICT-26-2018-2020.json` |
| 31115299Coordinationandsupportaction1562630400000 | Artificial intelligence for manufacturing | H2020-ICT-2018-20 | 31094503 | 2020-01-16 | `.../data/topicDetails/ICT-38-2020.json` |
| 31115283Innovationaction1574121600000 | Artificial Intelligence on demand platform | H2020-ICT-2018-20 | 31094503 | 2020-06-17 | `.../data/topicDetails/ICT-49-2020.json` |
| 44111901HORIZONResearchandInnovationActions1642636800000 | Artificial intelligence, big data and democracy | HORIZON-CL2-2022-DEMOCRACY-01 | 31094503 | 2022-04-20 | `.../data/topicDetails/HORIZON-CL2-2022-DEMOCRACY-01-01.json` |
| 42932405EDIDPActiongrant1586908800000 | Defence capabilities supported by artificial intelligence | EDIDP-AI-2020 | 31094503 | 2020-12-01 | `.../data/topicDetails/EDIDP-AI-2020.json` |

### Request 3 — tender type (`type:2`, FAQ excluded)

- Body `query`: `{"bool":{"must":[{"terms":{"type":["2"]}}],"must_not":[{"terms":{"DATASOURCE":["SEDIA_FAQ"]}}]}}`
- Outcome: **HTTP 200**; `totalResults: 3942`; returned 5; all `DATASOURCE:["SEDIA"]`.
- **Finding (important):** `type:2` does **not** cleanly mean "TED tender". The
  returned records are external-action / grant schemes, e.g. *"Town Twinning
  between Turkey and EU-II … Grant Scheme (TTGS-II)"* and
  *"Appui à la Gestion des Aires Protégées …"*, with `status` codes `99999998`
  and `310945031` (a different 9-digit scheme) and `url`s pointing at
  PROSPECTS/`topicDetails`. **Grant-call vs tender is therefore NOT distinguishable
  by `type` alone.**

## Response structure (observed)

Top level: `apiVersion`, `terms`, `totalResults`, `pageNumber`, `pageSize`,
`sort`, `results[]`. Each result: `reference`, `url`, `contentType`, `language`,
`summary`, `content`, `metadata{}`, `enrichedMetadata`, `children[]`.
`metadata` fields observed: `title[]`, `callIdentifier[]`, `status[]` (numeric
code), `deadlineDate[]`, `type[]`, `DATASOURCE[]`, `es_SortDate[]`,
`frameworkProgramme`, etc. (Note: fields are arrays — take the first element.)

## Explicit outcome

- **Genuine grant/topic records WERE retrieved** from the official EU API
  (Request 2): real HORIZON/H2020 topic titles, official `callIdentifier`s,
  deadlines, status codes, and official portal URLs.
- **Tender records were NOT cleanly verified.** The `type` facet mixes
  grant/external-action schemes, so "grant calls, tenders, upcoming notices, and
  expired notices" **cannot yet be kept distinct** using the fields observed so
  far. This is the concrete, evidence-based gap.

## Boundaries honored

- Production Vault and `src/data/generated/opportunity-data.json` untouched
  (no writes; md5 unchanged — no code path ran).
- No repeated requests, retry loops, scraping, or access-control bypass —
  3 single bounded read-only POSTs.
- No fixture records presented as live data; raw responses stayed in local temp.
- No staging, commits, pushes, or unrelated cleanup.

## Tests run

- **None.** No repository code was changed in this phase, so no automated suite
  was affected or executed; the deliverable is a live-source verification.

## Exact next step (for the implementation phase)

1. **Pin the tender contract first** with the official **FACET API**
   (`/rest/facet?apiKey=SEDIA`) to resolve `type`, `status`, and `DATASOURCE`
   reference codes, and identify the exact facet (e.g. `callIdentifier` prefix,
   `DATASOURCE`, or a `programme`/`type` combination) that isolates genuine
   TED-sourced tenders from external-action grants. Do **not** infer tender vs
   grant from `type` alone.
2. Add an isolated `src/automation/eu-sedia-adapter.ts` (mirroring the TED /
   Grants.gov adapters) that parses the verified `results[].metadata` shape:
   normalize `reference` → record id, derive the official portal URL, and carry
   `title`, `callIdentifier`, `deadlineDate`, `es_SortDate` (publication),
   `type`, `DATASOURCE`, and the raw numeric `status` code as **evidence** —
   never as an open/eligible verdict.
3. Add a same-origin bridge (`/__tvb/eu/search`) reusing `createFetchTransport`
   and the shared `dispatchBridgeRequest` boundary; the multipart body and
   required headers are built server-side with the endpoint fixed.
4. Only add offline tests using a **sanitized fixture derived from the verified
   contract** above (a couple of real `results[]` items with
   `DATASOURCE:["SEDIA","SEDIA_PRD_CENTRICITY"]` and `type:["1"]`), asserting
   grant/notice classification is by the pinned facet — not by `type`.
5. Do not claim company eligibility without verified company metadata (unchanged
   from the Grants.gov/TED rule).
