# Phase 21C — EU Funding & Tenders Portal (SEDIA) live grant discovery

Date: 2026-10-09
Scope: connect the verified EU Funding & Tenders Portal public search API
(`api.tech.ec.europa.eu`, SEDIA collection) to an in-app live funding search,
surfacing **grant topics** and **cascade funding calls** as real candidates
through the existing Phase D orchestrator + Phase C pipeline, with a same-origin
bridge and an explicit open-call gate. EU **tenders** (`type 0`) are deliberately
excluded this phase.

## What was built

| Area | File | Notes |
|------|------|-------|
| Source identity | `src/automation/registry.ts` | new `SU-EU-001` (`adapterType: 'eu-sedia'`, `accessState: 'UNKNOWN'`); registry now 7 entries |
| Pure adapter | `src/automation/eu-sedia-adapter.ts` | multipart query builder, DATASOURCE+type classification, response parser, injected transport |
| Open-call gate | `src/automation/eu-sedia-gate.ts` | rule `phase21c-1` |
| Classification | `src/automation/classify.ts` | additive funding raw-type aliases: `grant_topic`/`external_action_grant` → Grant, `cascade_funding_call` → Fund |
| Bridge contract | `src/live-source/eu-sedia-bridge/contract.ts` | path `/__tvb/eu/search` |
| Bridge handler | `src/live-source/eu-sedia-bridge/handler.ts` | ONE read-only multipart POST with portal browser headers |
| Bridge plugin | `src/live-source/eu-sedia-bridge/plugin.ts` | Vite dev + preview middleware |
| Live store | `src/live-source/live-eu-sedia-discovery.ts` | run-scoped registry; ONE shared search per run (not company-matched) |
| Vite wiring | `vite.config.ts` | mounts `tvbEuSediaBridge()` |
| UI | `Discovery.tsx`, `DiscoveryControls.tsx`, `DiscoveryResults.tsx` | new **Run Live EU Funding Search** button, EU banner/note, EU candidate rows + gate counts |
| Tests | `eu-sedia-adapter.test.ts`, `eu-sedia-gate.test.ts`, `eu-sedia-bridge/handler.test.ts`, `live-eu-sedia-discovery.test.ts`, `qa/eu-live.spec.ts` | offline |
| Script | `package.json` | `test:live` now includes `src/live-source/eu-sedia-bridge/*.test.ts` |

## Classification contract enforced (Phase 21B)

- Keys on `DATASOURCE` + `type`, never `type` alone.
- `SEDIA` and `SEDIA_PRD_CENTRICITY` (centroid duplicate) → classified by type
  code: `1` GRANT_TOPIC, `2` EXTERNAL_ACTION_GRANT, `8` CASCADE_FUNDING_CALL,
  `0` TENDER.
- `SEDIA_FAQ` → FAQ_DOCUMENT, excluded.
- Other databases / unknown codes → `UNKNOWN` (rawType `null`), never guessed.
- Requested default query types `["1","2","8"]`, statuses `["31094501","31094502"]`
  (forthcoming + open), `must_not DATASOURCE ["SEDIA_FAQ"]` (FAQ). Tenders not
  requested.
- Deduped by stable `reference` (also enforced downstream by pipeline tier 1).

## Open-call gate (`phase21c-1`)

A record is **Open (confirmed)** only when: source status == `open`
(`31094502`), a parseable deadline strictly in the future, an official
`https://ec.europa.eu/` link, and full provenance. Everything else is Excluded
with the exact reason. `forthcoming`/`closed`/`unknown`/missing deadline never
qualify.

## Verification

- `npm run typecheck` — clean.
- `npm run build` — OK (172 modules).
- `npm run test:automation` — **338 pass / 0 fail** (was 325; +13).
- `npm run test:live` — **88 pass / 0 fail** (was 80; +8).
- Playwright `discovery` + `ted-live` + `funding-live` — **40 pass / 0 fail** (no regression).
- Playwright `qa/eu-live.spec.ts` — **2 pass / 0 fail** (button separation + full offline EU run: 6 candidates → 3 Open confirmed / 3 Excluded).
- Snapshot `src/data/generated/opportunity-data.json` md5 unchanged
  (`17cfae825e1de5320705b066effec15b`).

### One bounded live request through the bridge (honest)

- Server: `npx vite preview --port 4173`; POST `http://localhost:4173/__tvb/eu/search`
  body `{"runId":"RUN-EU-LIVE21C","companyId":"RUN","keyword":"artificial intelligence","limit":5,"requestedAt":"2026-10-09T00:00:00.000Z"}`.
- Result: **HTTP 200**, `ok: true`, `apiVersion: 2.155`, `totalResults: 226`,
  returned 5, all `type: 1` (grant topics), `DATASOURCE` `SEDIA` /
  `SEDIA_PRD_CENTRICITY`, statuses `31094501` / `31094502`, official
  `https://ec.europa.eu/...` URLs. Sample titles: "Artificial Intelligence for
  Cybersecurity applications", "Towards the next generation of frontier
  Artificial Intelligence…".
- First attempt returned a forwarded source **HTTP 400** ("Invalid Query format")
  because the `query` part was wrongly wrapped as `{query:{bool:…}}`; fixed to
  the bare `{bool:…}` shape verified in Phase 21A, then re-verified HTTP 200.
  The bridge reported the source's real error faithfully rather than masking it.

## Honesty boundaries

- `SU-EU-001` stays `UNKNOWN` in the static registry; only a run-scoped view
  marks it `AVAILABLE`. No global promotion.
- No company eligibility is claimed; the run pool is shared, not company-matched.
- No EU tender is requested or presented this phase.

## Known / deferred

- EU tenders (`type 0`) remain out of scope (tender classification not fully
  verified in Phase 21B). Statuses `310945031` / `99999998` stay `unknown`.
- The `SEDIA_PRD_CENTRICITY` centroid records often carry stale/old deadlines;
  they are included but the gate excludes them unless genuinely open.
