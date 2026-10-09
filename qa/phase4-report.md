# Phase 4 Report — Live TED procurement source in the Discovery UI

## Objective
Connect the real TED (Tenders Electronic Daily) procurement source to the
normal Discovery panel with a **third, separate** "Run Live TED Search" button,
keeping the two fixture scenario modes untouched, and verify the entire
real-workflow chain: one live read-only TED search → the real adapter/pipeline →
candidates → Human review queue → approval (and rejection) → an atomic write of
an approved live notice into an **isolated** verification Vault. Then report
and stop (no automatic final regression).

## Why a same-origin bridge
A direct browser `fetch` to `https://api.ted.europa.eu/v3/notices/search` is
impossible: the source returns **no CORS headers** on OPTIONS/POST. The live
call therefore runs server-side. The approved design (user chose the
third-run-button option):

```
browser  --POST /__tvb/ted/search (same-origin, dev+preview)-->  Node handler
  <-- { ok, status, body } <----------------------------------  (ONE live POST via
                                                                createFetchTransport)
browser: response replayed through createTedAdapter({transport: in-memory sync})
  -> orchestrateDiscoveryRun (real Phase D path) -> candidate pipeline
  -> createReviewQueue + reviewFixtureStore.addReviewItems (real Phase E handoff)
```

`fetch-transport.ts` remains the codebase's **single** live network caller, and
the bridge is the only place it is used at runtime. The bridge never writes
anything and never downloads documents.

## What changed
New:
- `src/live-source/ted-bridge/contract.ts` — dependency-free contract
  (`TED_BRIDGE_SEARCH_PATH = '/__tvb/ted/search'`, request/response types).
- `src/live-source/ted-bridge/handler.ts` — Node handler: builds the
  `DiscoveryRequest`, runs the real query planner (`buildTedQueryPlan`) and body
  builder, performs exactly one POST, returns status + raw body. Validation
  failures and transport failures return explicit errors (`400` /
  `502 source_failure`) — never an invented empty success. Injectables keep unit
  tests offline.
- `src/live-source/ted-bridge/plugin.ts` — `tvbTedBridge()` Vite middleware on
  dev + preview; registered in `vite.config.ts`.
- `src/live-source/live-discovery.ts` — `createLiveTedDiscovery({bridge})`
  factory + `liveDiscoveryStore` default: run ids `RUN-T-####`, profile
  `DP-LIVE-001`, `requestedAt = new Date().toISOString()`, recent 90-day window
  (`YYYYMMDD`), limit 10, keyword falls back to companyId; full
  `beginRun/runCompany/finishRun/history/reset` with the same deep-freeze +
  validation discipline as the fixture store.
- `src/live-source/live-discovery.test.ts` (10 tests) and
  `src/live-source/ted-bridge/handler.test.ts` (7 tests) — offline, driven by the
  recorded TED response.
- `qa/verify-live-discovery.ts` — the standalone real-run script
  (`npx tsx qa/verify-live-discovery.ts`), an explicit twin of the browser
  button: one live POST, then the full pipeline, review court, and an
  isolated-vault write. Lives outside `src/` so its filesystem writes stay out
  of the vault-writer boundary scan (test 19a).
- `qa/ted-live.spec.ts` — 3 offline QA specs that intercept
  `**/__tvb/ted/search` with a byte-for-byte recorded TED response, so the whole
  in-browser chain (including "no external requests") is deterministic.

Type-level only + small exports in automation:
- `src/automation/ted-adapter.ts`: exported `OUTPUT_FIELDS` and
  `buildTedSearchBody(plan)` (no new tokens in the boundary-scanned module).
- `src/automation/discovery-fixture.ts`: `DiscoveryRunScenario` now includes
  `'live'`; `scenario` widened on `DiscoveryCompanyResult`/`DiscoveryRunOutcome`.

UI wiring:
- `src/pages/Discovery.tsx` — `runLiveDiscovery()`; run history merges
  `[...liveDiscoveryStore.history(), ...discoveryFixtureStore.history()]`.
- `src/components/discovery/DiscoveryControls.tsx` — third button
  "Run Live TED Search" + honest instruction text.
- `src/components/discovery/DiscoveryResults.tsx` — the results note is
  live-conditioned; "Real source" chip shown for `SU-TED-001`.
- `src/styles/components.css` — `.dg-run--live` style.
- `package.json` — `test:live` script.

## Verification

### Automated (offline, deterministic)
- `npx tsc -b` — clean.
- `npm run build` — clean (pre-existing chunk-size warning only).
- `npm run test:automation` — **288 passed / 0 failed** (the only automation
  edits are type-level, so the boundary/allowlist suites still hold).
- `npm run test:live` — **15 passed / 0 failed** (bridge handler + live store).
- `npm run test:qa` — **358 passed / 3 skipped / 0 failed**, including the three
  new `qa/ted-live.spec.ts` cases:
  1. a live run through the intercepted bridge shows the real notices through
     the real pipeline (`RUN-T-0001`, `Real source` chips, run summary, run
     history, exactly three same-origin bridge calls, zero external requests);
  2. the live run hands candidates into the Human review queue (13 rows = 4
     seeded + 9 live findings; `Poland – Solar energy` × 6, `Latvia` × 3);
  3. a bridge failure is a **Failed** run with no candidates, no review handoff,
     and an honest error surfaced — never an invented empty success.

### Real end-to-end (the one-off read-only TED search)
`npx tsx qa/verify-live-discovery.ts`, keyword `solar energy`:

```
bridge HTTP: 200 · ok: true · source status: 200            (ONE live POST)
runId: RUN-T-0001 · outcome: SUCCESS
counts: received 10 · created 10 · classifier-undeclared 3 · duplicates 0 · failed 0
review queue: 10 items handed to Human review
findings: 10 notices (real), e.g. 486089-2026 (Poland, cn-standard),
          496381-2026 (Germany, cn-standard), 501564-2026 (Ireland, can-standard),
          511136-2026 (Latvia, pin-only), 516876-2026 (Germany, cn-standard)
          — each with buyer, country, publication date, and the official
          https://ted.europa.eu/.../detail/<id> URL.
human review: approve of RI:DC:SU-TED-001:486089-2026:NORMALIZED → APPROVED
              reject of RI:DC:SU-TED-001:493081-2026:REVIEW → REJECTED
write proposal: READY for notice RFB-517
preview:  READY → preview reported no errors; nothing written
write:    CREATED → 09 - Notices/RFB-517 … Mysków.md (byte-equal to preview)
duplicate: ALREADY_EXISTS (same write refused again; still exactly one file)
```

The written record in the isolated vault is the expected Phase 4 artefact
(notice_id `RFB-517`, notice_number `486089-2026`, notice_type `Tender`,
procurement_method `Open` derived from `cn-standard`, `procuring_entity:
[[ORG-900 — Gmina Myszków]]`, issue_date `2026-07-14`, and a `notes` audit trail
recording every disclosed derivation — description from title, contract
type/lot structure `Unknown`). The vault contains exactly one org record and one
notice record, all under `qa/.artifacts/phase4-verify-vault`.

### Metrics semantics
The UI's "Candidates requiring review" cell = `outcome.needsReview`, the count
actually handed to Human review (so it matches the "Review N candidates" link
and the review page — verified 10 = 10 on the real run). The internal
`counts.candidatesRequiringReview` is intentionally narrower: candidates the
classifier could not fully declare (status `REVIEW`), e.g. 3 of 10 on the real
run; this distinction is pinned by the published fixture accounting in
`discovery-fixture.test.ts` (3 created → 3 needing review, 0 classifier-undeclared).

### Honesty guarantees
- Exactly **one** read-only POST per bridge request; no documents ever fetched.
- Any bridge/handler failure → explicit error → the adapter reports `FAILED`
  through the normal pipeline. A live run can never falsely produce candidates.
- The real workspace Vault (`<production-vault>`) was **never
  read or written**; every write in this phase targets the isolated
  `qa/.artifacts/phase4-verify-vault` (asserted in the script + Playwright's
  `TVB_VAULT_ROOT`).

## Funding-source feasibility
Blocked. GlobalTenders remains **registration-only metadata**: `accessState:
UNKNOWN`, no live adapter bound, so discovery against it is always `BLOCKED`
(a deliberate, registry-pinned safety posture). Phase 4 therefore adds exactly
one *live procurement* source (TED). There is still no live *funding* source;
funding stays snapshot-backed in the fixtures. A real funding feed would need a
new source with an available access state, an adapter, and the same
boundary/copy/honesty treatment as the TED bridge.

## Reproduce
```
npm run build
npm run test:qa          # 358 passed / 3 skipped / 0 failed (requires dist)
npm run test:live        # 15 passed
npm run test:automation  # 288 passed
npx tsx qa/verify-live-discovery.ts   # the real run (one TED POST)
```

## Stop
Per the agreed plan, no full regression was started after this report. The
standing suite result (358/3/0) already includes the new live-path specs; the
final source state is the identical bytes that passed it, and `tsc` +
`test:automation` (288/0) were re-verified after the last edit.