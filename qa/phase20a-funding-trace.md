# Phase 20A (funding trace) — Trace the Zero-Results Live Funding Path

Diagnostic only. No code, Vault, snapshot, tests, or git state were changed; no
live API calls were made.

> Naming note: this is `qa/phase20a-funding-trace.md`. The repository
> stabilization audit is a separate file, `qa/phase20a-report.md`.

---

## TL;DR

The **Run Live Funding Search** button is hard-wired to **USAspending
(`SU-US-001`)** end to end. It calls `/__tvb/usaspending/search`, not
`/__tvb/grantsgov/search`. **Grants.gov (`SU-GRANTS-001`) is registered and its
bridge route is mounted, but nothing in the UI, store, or orchestrator can reach
it.** USAspending returns *historical award records* (deadline always `null`),
so a "zero results" funding run is an honest award-search result, not a missing
open-opportunity search.

---

## Confirmed facts (with file:line)

### Q1 — Which source ID and adapter does the button invoke?

**`SU-US-001` (USAspending) with `createUsaSpendingAdapter`.**

- Button: `Run Live Funding Search` — `src/components/discovery/DiscoveryControls.tsx:120`,
  calling the `onRunLiveFunding` prop.
- Wired to `runLiveFundingDiscovery` at `src/pages/Discovery.tsx:228`.
- Handler: `src/pages/Discovery.tsx:150` → `liveUsaSpendingDiscoveryStore.beginRun`
  (`:163`), `.runCompany` (`:173`), `.finishRun` (`:181`).
- Store: `createLiveUsaSpendingDiscovery` (`src/live-source/live-funding-discovery.ts:121`),
  exported singleton `liveUsaSpendingDiscoveryStore` (`:337`).
- Source id hard-coded: `USA_SPENDING_SOURCE_ID` at
  `live-funding-discovery.ts:149` (adapter map), `:165` (`sourceIds`).
- Adapter hard-coded: `createUsaSpendingAdapter(...)` at
  `live-funding-discovery.ts:258`.
- Bridge client: `defaultUsaSpendingBridgeClient` posts to
  `USA_BRIDGE_SEARCH_PATH` (`live-funding-discovery.ts:76-85`).

### Q2 — Is `SU-GRANTS-001` reachable from UI/store/orchestrator?

**No — registration and bridge only.** Every reference to Grants.gov
(`grep -rli grantsgov src`):
`src/automation/grantsgov-adapter.ts`, its test, `src/automation/registry.ts`
(+test), and `src/live-source/grantsgov-bridge/{contract,handler,plugin}.ts`
(+test). There is **no** import of the Grants.gov adapter or bridge in
`Discovery.tsx`, `live-funding-discovery.ts`, `orchestrator.ts`, or any component.

- The store binds exactly one source: `dependenciesFor()` → `{[USA_SPENDING_SOURCE_ID]: adapter}`
  (`live-funding-discovery.ts:148-150`).
- `inputFor()` sets `sourceIds: [USA_SPENDING_SOURCE_ID]` (`:165`).
- Registry entry exists (`registry.ts`: `SU-GRANTS-001`, `accessState: 'UNKNOWN'`)
  and the adapter exists, but neither is imported by the live surface.

### Q3 — Does the request reach `/__tvb/grantsgov/search` or another mounted route?

**It reaches `/__tvb/usaspending/search`.** Exact, verified route constants:

| Route constant | Value | Source |
|---|---|---|
| `TED_BRIDGE_SEARCH_PATH` | `/__tvb/ted/search` | `src/live-source/ted-bridge/contract.ts` |
| `USA_BRIDGE_SEARCH_PATH` | `/__tvb/usaspending/search` | `src/live-source/usaspending-bridge/contract.ts:17` |
| `GRANTS_GOV_BRIDGE_SEARCH_PATH` | `/__tvb/grantsgov/search` | `src/live-source/grantsgov-bridge/contract.ts:18` |

Mounted in two places:
- **Vite dev + preview middleware:** `vite.config.ts:4-6` imports
  `tvbVaultBridge`, `tvbTedBridge`, `tvbUsaSpendingBridge`, `tvbGrantsGovBridge`;
  registered at `vite.config.ts:18`. Each plugin mounts its own POST path.
- **Standalone host allowlist:** `server/serve.ts:47-49` maps
  `TED_BRIDGE_SEARCH_PATH`, `USA_BRIDGE_SEARCH_PATH`, `GRANTS_GOV_BRIDGE_SEARCH_PATH`
  into the bridge route table consumed by `server/app.ts:217` (unknown
  `/__tvb/*` → 404, `server/app.ts:168-171`).

So the Grants.gov route **is mounted** and would answer if called — but the UI
only ever calls the USAspending client.

### Q4 — Does the UI display the actual source/response, or hardcode USAspending?

**Mixed.** Per-source rows are truthful (rendered from the pipeline): the run
shows `result.sourceId` and `result.sourceName` + a `Real source` chip
(`src/components/discovery/DiscoveryResults.tsx:136-140`, chip via
`labels.ts:34-39`). But the **live-funding banner and note are hardcoded to
USAspending**:

- `DiscoveryResults.tsx:90` — `isLiveFunding = scenario === 'live' && domain === 'funding'`.
- `DiscoveryResults.tsx:95-99` — renders
  `"Live source: USAspending (SU-US-001) — US federal awards, not open grant solicitations."`
  whenever `isLiveFunding`, regardless of the true source.
- `DiscoveryResults.tsx:110-112` — the explanatory note again hardcodes USAspending.

**Hypothesis (would be a bug once Grants.gov is wired):** a `scenario:'live'`,
`domain:'funding'` Grants.gov run would still display the USAspending banner,
because the label is keyed on domain/scenario, not on `sourceId`.

### Q5 — Are `oppStatus`, `closeDate`, and official URLs preserved?

| Field | Adapter emits | Survives transform | Survives normalize | Shown in run UI |
|---|---|---|---|---|
| `oppStatus` | `sourceStatus` (`grantsgov-adapter.ts:298`) | **No — dropped** | n/a | No |
| `closeDate` | `deadline` (`grantsgov-adapter.ts:294`) | Yes → `sourceDeadline` (`transform.ts:67`) | Yes (`normalize.ts:186,233,245`) | No |
| official URL | `sourceUrl` (`grantsgov-adapter.ts:281,290`) | Yes (`transform.ts:63`) | Yes, canonicalized (`normalize.ts:183,242`) | No |

- **`oppStatus` is lost at transform.** `candidateFromRawResult`
  (`src/automation/transform.ts:42-93`) copies id/url/title/description/dates/
  organization/country/rawType but **never `raw.sourceStatus`**. The candidate
  model has no status field (`src/automation/candidate.ts:51-93`), and
  `sourceStatus` appears nowhere in `normalize.ts`, `classify.ts`, or
  `dedup.ts`. So the normalized source status never reaches classification,
  gating, matching, or the UI.
- `closeDate` → `candidate.sourceDeadline` → `normalization.deadline` is
  preserved (possibly date-normalized; original kept in the `{original,
  normalized}` pair).
- The official URL → `candidate.sourceUrl` + `provenance.sourceUrl` and
  `normalization.canonicalUrl` is preserved. `DiscoveryResults` only renders
  `candidate.sourceTitle` (`DiscoveryResults.tsx:156`), so status/deadline/URL
  are **not** surfaced on the run-result screen (they remain on the candidate
  for the review/detail surfaces).
- USAspending never emits `sourceStatus` and always sets `deadline: null`.

### Q6 — What would make Grants.gov the live open-opportunity source?

Minimal plan (see full plan below): add a Grants.gov live store + bridge client,
a source selector in the panel, a transform pass-through for `sourceStatus`,
classification alias for `grant_opportunity`, and a status/date gate before a
candidate is treated as an *open opportunity*.

### Other confirmed facts relevant to the fix

- **No open/closed/expired gating exists.** `deriveRunOutcome`
  (`src/automation/orchestrator.ts:260-274`) only rolls up SUCCESS / NO_RESULTS /
  PARTIAL / BLOCKED / FAILED counts. `dedup.ts` de-duplicates by
  url/org/country/deadline/composite key; it does **not** drop closed or expired
  records.
- **Classification has no `grant_opportunity` alias.** `FUNDING_RAW_TYPE_ALIASES`
  (`src/automation/classify.ts:30-32`) maps only `grant`/`grants`. Grants.gov
  `rawType: 'grant_opportunity'` and USAspending `grant_award` fall through to
  title-hint matching (`classify.ts:126-136`) or `NEEDS_REVIEW`.
- **Empty-success honesty:** a SUCCESS result with zero candidates is coerced to
  `NO_RESULTS` (`orchestrator.ts:245`), which is why an empty USAspending search
  surfaces as `Completed (no results)` (`DiscoveryResults.tsx:66-74`).
- **QA coverage is USAspending-only:** `qa/funding-live.spec.ts` intercepts
  `**/__tvb/usaspending/search` (`:21`), asserts `SU-US-001`/`USAspending`
  (`:90-91`), and asserts the awards banner (`:84-85`). No spec references
  Grants.gov.

---

## Actual data flow (confirmed)

```
[Button] DiscoveryControls.tsx:120 "Run Live Funding Search"
  onRunLiveFunding
    → Discovery.tsx:228 → runLiveFundingDiscovery (Discovery.tsx:150)
      → liveUsaSpendingDiscoveryStore.beginRun({sector,keyword,location})
          live-funding-discovery.ts:200  (sourceIds fixed = SU-US-001)
      → per company: .runCompany(context, companyName)
          live-funding-discovery.ts:229
            → options.bridge(...)  → defaultUsaSpendingBridgeClient
                POST /__tvb/usaspending/search   (live-funding-discovery.ts:78)
            ← {ok,status,body}
            → createUsaSpendingAdapter({transport: replayBody, registry})  (:258)
            → orchestrateDiscoveryRun(input, {registry, adapters:{SU-US-001}}) (:260)
                transform → normalize → classify → dedup
      → .finishRun(context, results)  (:278)
  → setOutcome(...) → <DiscoveryResults> (hardcoded USAspending banner at :95)
```

Bridge side: Vite plugin `tvbUsaSpendingBridge` (dev/preview) or the
`server/serve.ts:47-49` allowlist in production → `handleUsaSpendingBridge`
(`src/live-source/usaspending-bridge/handler.ts`) → one live POST to
`https://api.usaspending.gov/api/v2/search/spending_by_award/`. The Grants.gov
bridge (`/__tvb/grantsgov/search` → `handleGrantsGovBridge` →
`https://api.grants.gov/v1/api/search2`) is mounted but has **no caller**.

---

## Hypotheses (not yet verified)

- H1: Wiring Grants.gov would immediately mislabel the run as USAspending
  because the banner (Q4) is keyed on domain/scenario, not `sourceId`.
- H2: `SU-GRANTS-001` being `accessState:'UNKNOWN'` (`registry.ts`) means the
  Grants.gov adapter would return **BLOCKED** through the orchestrator if it were
  wired without first promoting the access state to `AVAILABLE`.
- H3: Because `oppStatus` is dropped at transform (Q5) and there is no
  status/date gate, "closed" opportunities returned in `oppStatuses=posted|
  forecasted` handling — or any `closed`/`archived` value — could pass through as
  candidates if the status filter were widened.

---

## Q7 — Tests that would prove the intended behavior

1. **UI actually calls Grants.gov:**
   `page.route('**/__tvb/grantsgov/search', ...)` returns an official `search2`
   body; assert the request hits that path (and **not**
   `**/__tvb/usaspending/search`), and that the run banner names Grants.gov /
   `SU-GRANTS-001` rather than USAspending.
2. **Open vs closed/expired rejection:** supply oppHits with
   `oppStatus: 'closed'` and `oppStatus: 'posted'` with a `closeDate` in the past;
   assert they are **not** surfaced as open opportunities (and the run is honest
   about why), while a `posted`/`forecasted` record with a future `closeDate` is.
3. **Status preservation:** unit test that `raw.sourceStatus` survives
   transform → candidate (fails today, Q5).
4. **Duplicate rejection:** two oppHits with the same id/official URL produce one
   candidate (`dedup.ts`), asserted in a Grants.gov live test.
5. **Unverified source rejected:** with the registry entry left `UNKNOWN`, assert
   the Grants.gov store reports BLOCKED, never querying the bridge.
6. **USAspending stays awards-only:** keep `qa/funding-live.spec.ts` green and
   add an assertion that the awards framing is still shown for `SU-US-001`.

Existing tests to extend: `qa/funding-live.spec.ts`,
`src/automation/grantsgov-adapter.test.ts`,
`src/live-source/grantsgov-bridge/handler.test.ts`,
`src/automation/registry.test.ts`, `src/automation/transform`/`classify` tests.

---

## Minimal implementation plan

1. **Transform pass-through:** add `sourceStatus` to `DiscoveryCandidate`
   (`transform.ts:51-93`; `candidate.ts`) so `oppStatus` survives.
2. **Classification alias:** add `grant_opportunity` → `Grant` to
   `FUNDING_RAW_TYPE_ALIASES` (`classify.ts:30`).
3. **Open-opportunity gate:** compute "open" only from `sourceStatus ∈
   {posted, forecasted}` **and** a future `deadline`; never infer open from
   missing data. Keep USAspending (awards, `deadline: null`) classified as award
   context, not open solicitations.
4. **Grants.gov live store + client:** mirror `live-funding-discovery.ts` with a
   `defaultGrantsGovBridgeClient` posting to `GRANTS_GOV_BRIDGE_SEARCH_PATH`, and
   reuse the real orchestrator with `createGrantsGovAdapter`.
5. **UI source selector:** let the user choose Funding source (USAspending
   awards vs Grants.gov opportunities) and make the banner/note derive from the
   actual `sourceId` (fix Q4/H1).
6. **Registry promotion:** only after a verified read-only query, flip
   `SU-GRANTS-001` to `AVAILABLE` (fix H2).
7. **Tests** per Q7.

## Files to change (for the fix phase, not now)

`src/automation/transform.ts`, `src/automation/candidate.ts`,
`src/automation/classify.ts`, new `src/live-source/live-grantsgov-discovery.ts`,
`src/pages/Discovery.tsx`, `src/components/discovery/DiscoveryControls.tsx`,
`src/components/discovery/DiscoveryResults.tsx`, `src/automation/registry.ts`,
plus new/updated tests.
