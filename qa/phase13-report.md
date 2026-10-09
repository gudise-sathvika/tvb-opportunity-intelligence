# Phase 13 Report — Shared HTTP Boundary for the Bridges

Status: **Implemented and verified.** One new host-independent module now owns
every cross-cutting concern that was previously duplicated (or missing) across
the three Vite bridge plugins. No production server was created, no dependency
was added, the outbound caller (`fetch-transport.ts`) is untouched, and the
write-capable Vault bridge remains private (still only mounted on `vite dev` /
`vite preview`, never on a public host).

## Why

Phase 12 established that the correction for a real host is to reuse the
existing framework-agnostic handlers (`handleTedBridge` / `handleUsaSpendingBridge`
/ `handleVaultBridge`) behind a thin server. Before doing that, the *inbound*
HTTP handling — route match, method check, Content-Type check, bounded body read,
parse, timeout, error envelope — lived copy-pasted inside each `plugin.ts`, and
several controls simply did not exist (no body-size cap, no Content-Type check,
no request timeout, unclamped `limit`). This phase factors that logic into one
tested module so any future host inherits the same guarantees.

## What changed

New:
- `src/live-source/http-boundary.ts` — host-independent boundary:
  - `BRIDGE_MAX_BODY_BYTES` = 64 KiB; `BRIDGE_REQUEST_TIMEOUT_MS` = 30 s;
    `BRIDGE_JSON_CONTENT_TYPE` = `application/json`.
  - `BridgeRequest` (structural: async-iterable body + `method` / `url` /
    `headers`), so a Node `IncomingMessage` (Vite/Connect or `node:http`) fits
    with no adapter.
  - `JsonBridgeHandler`, `DispatchConfig`, `DispatchResult`,
    `dispatchBridgeRequest(request, config)` — returns `null` when no route
    matches (caller continues), otherwise `{ httpStatus, body }`.
  - `clampSearchLimit(value, fallback)` — finite numbers floored and clamped to
    **1–100**; everything else falls back.
  - Structured error envelope for boundary failures:
    `{ ok:false, error:{ code, message } }` with codes
    `method_not_allowed` 405, `unsupported_media_type` 415,
    `payload_too_large` 413, `malformed_json` 400, `bridge_timeout` 504,
    `bridge_failure` 500.
  - Body capped two ways: a declared `Content-Length` over the cap is rejected
    before reading; a chunked/lying body is caught mid-stream by a running
    byte count. Timeout is a response-level `Promise.race` (does not abort
    handler internals — the outbound leg keeps its own 20 s `AbortSignal`).
- `src/live-source/http-boundary.test.ts` — 13 deterministic tests (no network).

Changed:
- `src/live-source/ted-bridge/plugin.ts`,
  `src/live-source/usaspending-bridge/plugin.ts`,
  `src/vault-bridge/plugin.ts` — each now declares a `ROUTES` map and calls
  `dispatchBridgeRequest`; the Vite-specific part is only "mount middleware on
  dev + preview". The Vault plugin keeps its private design: vault root comes
  only from the server's own `TVB_VAULT_ROOT`, extracted per request; the
  plugin docstring states it must not be exposed publicly.
- `src/live-source/ted-bridge/handler.ts`,
  `src/live-source/usaspending-bridge/handler.ts` — `limit` now uses
  `clampSearchLimit` instead of inline `Math.floor`.

Unchanged (deliberately):
- `src/live-source/fetch-transport.ts` — the single outbound caller, still 20 s
  hard timeout, fixed endpoints.
- All `contract.ts` files and handler response shapes.
- `src/data/generated/opportunity-data.json` — untouched.

## Controls: before vs after

| Control | Before | After |
|---|---|---|
| Route match | per-plugin inline | shared, returns `null` on no match |
| Method check | inline 405 | shared 405 `method_not_allowed` |
| Content-Type check | **absent** | shared 415 `unsupported_media_type` |
| Request body cap | **absent (unbounded)** | 64 KiB → 413 `payload_too_large` |
| Response timeout | **absent** | 30 s → 504 `bridge_timeout` |
| Error envelope | per-plugin loose shape | one `{ ok, error }` shape |
| `limit` clamp | **absent** | 1–100 via `clampSearchLimit` |

Still missing / out of scope for this phase (tracked, not implemented):
CORS/origin policy, rate limiting, concurrency cap, authentication/access
control, request logging/audit, deployment + CI. The write-capable Vault
bridge must stay reachable only by trusted operators.

## Verification (all on 2026-10-09)

- Focused boundary: `npx tsx --test src/live-source/http-boundary.test.ts` →
  **13 pass / 0 fail**.
- `npm run test:live` → **31 pass / 0 fail** (18 prior + 13 boundary; both
  handler suites still green, confirming the `limit` clamp preserves the
  `limit:5` / `limit:10` cases).
- `npm run typecheck` → exit **0**.
- `npm run build` → **✓ built in 2.22s**.
- Vite-route regression: `npx playwright test qa/vault-write.spec.ts` →
  **2 pass / 0 fail** — the refactored Vault middleware still matches routes,
  reads the body, and (for a READY preview) writes exactly one record through
  the real preview server.
- Full suite: `npx playwright test` → **364 passed / 3 skipped / 0 failed**
  (identical to the Phase 8 baseline).

## Assurance

- **No live discovery:** all tests are deterministic; the boundary test never
  touches the network, and `fetch-transport.ts` was not invoked by any
  verification command.
- **No Vault mutation:** no command targeted the production vault; the
  vault-write spec writes only to its own temporary directory.
- **No protected-file change:** `src/data/generated/opportunity-data.json`
  preserved; `ensure-snapshot` reported "existing snapshot present; left
  untouched".

## Net effect

The three bridges now share one tested inbound HTTP contract, adding four
previously-missing controls (Content-Type, body-size cap, request timeout,
`limit` clamp) while removing duplicated code. A future host can reuse
`dispatchBridgeRequest` verbatim, so the Phase 12 server plan now inherits
these guarantees for free. Deployment, access control, and rate limiting
remain the outstanding production concerns.
