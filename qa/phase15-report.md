# Phase 15 Report — Production Host Security Hardening

Status: **Implemented and verified.** The Phase 14 host (`server/`) now enforces
a bounded concurrency limit, fails startup on unsafe/invalid configuration, and
has unit + integration test evidence for concurrency and configuration. The
Vault-write bridge is still not mounted. No dependency was added, nothing was
deployed, no external request or Vault write occurred, and no protected data
changed.

Timebox: completed within 20 minutes.

## 1. Review: what Phase 14 enforced vs. what was only a warning

Enforced in code (before this phase):
- Loopback bind by default (`127.0.0.1`); `X-Content-Type-Options: nosniff`.
- Bridge-only rate limit (fixed window, bounded key map), origin policy
  (same-origin + explicit allowlist), 64 KiB body cap, response timeout,
  Content-Type/JSON validation, structured error envelope — all via the shared
  `dispatchBridgeRequest`.
- Static serving confined to `dist/` with path-traversal protection.
- No request bodies/headers/credentials logged.

Only a warning/recommendation (before this phase):
- Non-loopback bind merely printed a warning and proceeded.
- Invalid env values **silently fell back to defaults** (`intFrom`) — a typo
  could silently weaken a limit.
- No concurrency cap: an unbounded number of simultaneous bridge requests could
  each trigger an outbound 20 s source call.
- No validation of origin format, port range, or timeout/limit bounds.

## 2. Files changed and rationale

New:
- `server/concurrency.ts` — `ConcurrencyGate`: bounded, **queue-free**
  (`tryAcquire()` → `false` when full; `release()`; `inFlight` getter). Rejects a
  bad limit at construction.
- `server/concurrency.test.ts` — 4 unit tests.
- `server/config.test.ts` — 6 config-validation tests.
- `server/rate-limit.test.ts` — 4 rate-limit boundary tests.

Changed:
- `server/config.ts` — `readInt` now **throws `ConfigError`** for a present-but-
  invalid value (non-integer or out of range) instead of falling back. Added
  `readHost` (rejects a non-loopback `TVB_HOST` unless `TVB_ALLOW_NON_LOOPBACK=1`),
  `readOrigins` (validates each allowlist entry is a bare `http(s)://host[:port]`
  origin), and range bounds for port (1–65535), window (1 s–24 h), rate max/keys,
  body bytes (1–1 MiB), timeout (1–120 s), and the new `maxConcurrent` (1–1000,
  default 4). New `ConfigError` class.
- `server/app.ts` — added `AppOptions.maxConcurrent`; a `ConcurrencyGate` is
  acquired after the rate-limit check and released in a `finally`, so every
  completed, failed, timed-out, or aborted request frees its slot. Overload
  returns **503** `{ ok:false, error:{ code:'server_busy', … } }` with
  `Retry-After: 1` and no queue.
- `server/serve.ts` — passes `maxConcurrent`; catches `ConfigError`, prints
  `[tvb-host] invalid configuration: …` and sets exit code 1; logs the active
  limits (marked in-memory/per-process); the non-loopback warning is now
  unreachable without the explicit opt-in.
- `server/app.test.ts` — added an integration test that issues simultaneous
  requests against `maxConcurrent:1` (second is rejected 503) and confirms the
  slot is reused afterwards; added a test that the slot is released after a
  **timeout** (504) and after a **handler failure** (500).

Unchanged: handlers, contracts, `http-boundary.ts`, `fetch-transport.ts`,
`vite.config.ts`, Vite plugins, and the Vault modules.

## 3. Security controls — enforced vs. remaining gaps

Enforced now:
- **Bounded concurrency** (queue-free) with structured 503 + `Retry-After`.
- **Strict config validation** that fails startup instead of disabling limits.
- **Safe bind**: loopback default; public bind requires explicit opt-in.
- **Bounded rate limit** (per-client fixed window, capped key map) — documented
  as *not authentication* and as **per-process / not distributed**.
- Body cap, response timeout, Content-Type/JSON validation, path-traversal
  safety, `nosniff` (from Phase 14).

Remaining gaps (documented; the host is **not** production-ready/publicly
exposable):
- No authentication/authorization. Origin allowlisting and rate limiting are
  abuse controls only, NOT authentication.
- Rate limiting is **in-memory and per process**: N instances multiply the
  effective limit; no shared store; resets on restart.
- No TLS (must terminate at a reverse proxy), no trusted-proxy handling
  implemented, no distributed concurrency/rate coordination.
- No health/readiness endpoint or graceful-shutdown handler yet (contract
  documented below).
- No deployment/CI, monitoring, or process management; run via `tsx`, not a
  compiled artifact.

## 4. Deployment security contract (documented, not implemented)

- **TLS:** terminate HTTPS at a reverse proxy (nginx/Caddy). The Node process
  speaks HTTP on loopback; never expose the plain listener publicly.
- **Authentication:** any public or cross-user deployment MUST sit behind an
  authenticated proxy (SSO or a shared secret verified server-side). Origin
  allowlisting/CORS is **not** authentication.
- **Trusted proxies:** `req.socket.remoteAddress` is used for the rate-limit
  key; `X-Forwarded-For`/`Forwarded` are deliberately NOT trusted. If a proxy
  is used, configure the proxy to set the source address and, if those headers
  are ever adopted, trust them only from known proxy IPs.
- **Secrets/env:** read-only live bridges need no credentials; do not set
  `TVB_VAULT_ROOT` on any host (the Vault bridge is not even mounted). Keep
  secrets out of source; supply config via environment only.
- **Health/readiness:** a future `GET /healthz` should return 200 once the
  process is listening and `dist/` is present; readiness should also confirm
  config was validated. (Not implemented this phase.)
- **Graceful shutdown:** on `SIGTERM`/`SIGINT`, stop accepting connections
  (`server.close()`), call `server.closeAllConnections()` after a short grace
  period, and exit — so in-flight 20 s source calls finish or are cut cleanly.
  (Not implemented this phase.)
- **Logging:** log startup/bind and errors only; never log request bodies,
  headers, or credentials (already true).

## 5. Test evidence

Concurrency & configuration tests (new):
- `ConcurrencyGate`: rejects `0`/`-1`/`1.5`; grants exactly `max` then refuses
  without queueing; release frees a slot; unbalanced release never goes negative.
- Integration: `maxConcurrent:1` → first request holds the slot, a simultaneous
  second returns **503 `server_busy`**, and after release a new request returns
  **200**; the slot is released after a **504 timeout** and after a **500
  handler failure**.
- Config: empty env → safe defaults; valid overrides parsed; out-of-range/
  non-integer port throws; non-loopback host throws without opt-in (allowed
  with `TVB_ALLOW_NON_LOOPBACK=1`); malformed/`ftp:`/path-bearing origins throw;
  unsafe numeric limits throw.
- Rate-limit boundaries: exactly `max` allowed, `max+1` rejected (with
  `retryAfterMs`); window reset; per-key scoping; key map bounded by `maxKeys`.

Exact commands and results (2026-10-09):
- `npx tsx --test server/*.test.ts` → **27 pass / 0 fail**.
- `npm run test:live` → **58 pass / 0 fail** (42 prior + 16 new).
- `npm run typecheck` → exit **0**.
- `npm run build` → **✓ built in 3.35s**.
- `npx playwright test` → **364 passed / 3 skipped / 0 failed** (unchanged
  baseline; Vite dev/preview routes preserved).

## 6. Local smoke test (no external requests)

- `TVB_PORT=99999 npm run serve` → `invalid configuration: TVB_PORT must be
  between 1 and 65535, got 99999`, exit **1**.
- `TVB_HOST=0.0.0.0 npm run serve` → rejected (non-loopback requires explicit
  opt-in), exit **1**.
- `TVB_ALLOWED_ORIGINS=ftp://x npm run serve` → rejected (must be http/https),
  exit **1**.
- Valid `127.0.0.1:4175`, `maxConcurrent=2`, `rateLimit=3`, `maxBodyBytes=64`:
  startup log printed the limits; `/` → 200 `text/html`; `/companies` → 200 (SPA
  fallback); `POST /__tvb/ted/search {}` → 400 `invalid_request` (fails
  validation before any transport call); oversized body → 413
  `payload_too_large`; `POST /__tvb/vault/write` → 404 `not_found`; repeated
  bridge POSTs hit the limit → 429 as expected.

## 7. Assurance

- **No public binding or deployment:** binds `127.0.0.1`; public bind requires
  an explicit opt-in flag.
- **No live discovery / external HTTP:** all tests mock the transport; smoke
  requests failed validation before reaching `createFetchTransport`.
- **No Vault writes; Vault bridge not mounted:** `/__tvb/vault/*` → 404 and no
  `server/*.ts` imports the vault bridge/writer (asserted in tests).
- **No protected-data change:** `src/data/generated/opportunity-data.json` md5
  still `17cfae825e1de5320705b066effec15b`; `ensure-snapshot` left it untouched.
- No new dependency was added.

The host is **hardened but not production-ready**: local tests passing does not
establish readiness — authentication, TLS, distributed limiting, readiness
probes, and deployment remain outstanding.
