# Phase 14 Report — Minimal Node.js Production Host

Status: **Implemented and verified.** A minimal zero-dependency `node:http`
server now serves the built SPA from `dist/` and mounts **only** the two
read-only live bridges (`/__tvb/ted/search`, `/__tvb/usaspending/search`). It
reuses the existing handlers and the shared `dispatchBridgeRequest` boundary
verbatim. The Vault-write bridge is not registered, and the host imports no
Vault-writer code. No dependency was added, nothing was deployed or bound
publicly, and no external request or Vault write occurred.

Timebox: completed within 20 minutes.

## Files changed

New:
- `server/app.ts` — framework-agnostic request listener: static + SPA fallback,
  bridge routing (TED/USA only), browser-origin policy, per-client rate limit,
  `nosniff` header, never logs bodies. Delegates method/Content-Type/body-cap/
  JSON-validation/timeout/error-envelope to `dispatchBridgeRequest`.
- `server/config.ts` — `readHostConfig(env)` with safe defaults; loopback host
  (`127.0.0.1`), port `4174`, origin allowlist (empty = same-origin only),
  rate-limit window/max/keys, body cap, request timeout.
- `server/rate-limit.ts` — `FixedWindowRateLimiter` with a bounded key map
  (oldest-key eviction at `maxKeys`) and `Retry-After` support.
- `server/serve.ts` — entrypoint (`npm run serve`); wires the real TED/USA
  handlers with the default `createFetchTransport`, binds loopback by default,
  sets `requestTimeout`/`headersTimeout`, and warns loudly on a non-loopback
  bind.
- `server/app.test.ts` — 11 deterministic tests (no real upstream).

Changed:
- `package.json` — added `"serve": "tsx server/serve.ts"` (existing `tsx`
  dev-dependency; no new dependency) and appended `server/*.test.ts` to
  `test:live`.
- `tsconfig.node.json` — added `server/**/*.ts` to the typecheck program.

Unchanged (deliberately): both handlers, both contracts, `http-boundary.ts`,
`fetch-transport.ts`, all Vite plugins, `vite.config.ts`. No Vault module was
touched and `src/data/generated/opportunity-data.json` was not modified.

## Route policy (as implemented)

- Mounted: `POST /__tvb/ted/search`, `POST /__tvb/usaspending/search`.
- Not mounted: `/__tvb/vault/preview`, `/__tvb/vault/write` → `404 not_found`.
- Unknown `/__tvb/*` → `404 not_found`; never forwarded to any upstream.
- Non-`/__tvb/*`: `GET`/`HEAD` static from `dist/`, SPA fallback to
  `index.html` for extension-less paths, `404` for missing assets, `405` for
  other methods.
- Path traversal blocked (`safeResolve` confines every static path to `dist/`).

## Security controls (implemented vs. remaining)

Implemented:
- **Origin policy:** a request with a browser `Origin` is allowed only if it is
  same-origin (matches the `Host` header) or in `TVB_ALLOWED_ORIGINS`;
  otherwise `403 origin_not_allowed`. Documented explicitly as *not*
  authentication. `OPTIONS` preflight handled for allowlisted origins.
- **Bounded rate limit:** fixed-window per `req.socket.remoteAddress`, default
  30 req / 60 s, key map capped at 5,000 (oldest evicted). `429` + `Retry-After`.
  Applied to bridge routes only; static assets are not limited.
- **Request-size limit:** 64 KiB cap via the shared boundary → `413`.
- **Request timeouts:** 30 s response timeout via the boundary → `504`; Node
  `requestTimeout`/`headersTimeout` set to `timeoutMs + 5 s`.
- **Safe JSON validation / Content-Type enforcement:** shared boundary → `415`
  / `400 malformed_json`.
- **Loopback-by-default:** `TVB_HOST=127.0.0.1`; non-loopback bind prints an
  explicit "not suitable for public exposure" warning.
- **No sensitive logging:** the server logs only the bind address, dist dir,
  and route list — never request bodies, headers, or credentials.
- **No secrets in source:** live bridges need no credentials; no secret added.

Remaining gaps (documented, not implemented — do NOT expose publicly):
- No authentication/authorization. Origin allowlisting and rate limiting are
  abuse controls only; a non-browser client is not authenticated.
- No TLS (terminate at a reverse proxy), no concurrency cap, no persistent
  (cross-process) rate-limit store.
- No deployment/CI, monitoring, or process management.
- `dist/` must exist (build first); the server is run via `tsx` (project
  tsconfigs are `noEmit`), not a compiled JS artifact.

## Tests executed (2026-10-09)

- `npx tsx --test server/app.test.ts` → **11 pass / 0 fail**:
  static index + asset types; SPA fallback vs missing-asset 404; path-traversal
  blocked; valid TED/USA through the real handlers with mocked transports;
  invalid-request envelope; unsupported method / unknown bridge (handler never
  called); disallowed vs same-origin vs allowlisted origins + preflight;
  bounded rate limit (429) with static unaffected; malformed (400) and
  oversized (413); handler timeout (504); Vault-write route 404 + source-level
  proof that no server file imports the vault bridge/writer.
- `npm run test:live` → **42 pass / 0 fail** (31 prior + 11 server).
- `npm run typecheck` → exit **0**.
- `npm run build` → **✓ built in 2.87s**.
- `npx playwright test` → **364 passed / 3 skipped / 0 failed** (unchanged
  baseline; Vite dev/preview routes preserved).
- **Real startup smoke** (`npm run serve`, loopback 4174, built `dist/`):
  `/` → `200 text/html`; `/companies` → `200 text/html` (SPA fallback);
  `/assets/nope.js` → `404`; `POST /__tvb/ted/search` `{}` → `400
  invalid_request`; `POST /__tvb/usaspending/search` `{}` → `400
  invalid_request`; `POST /__tvb/vault/write` → `404 not_found`. The empty
  bodies fail validation before any transport call, so **no external request
  was made**.

## Assurance

- **Vault-write bridge not exposed:** it is not in the route table (`404`) and
  no `server/*.ts` file imports `vault-bridge`/`vault-writer` or references
  `handleVaultBridge` (asserted in `app.test.ts`).
- **No live discovery / external HTTP:** all tests mock the transport; the
  smoke test's only bridge calls returned validation errors before reaching
  `createFetchTransport`.
- **No production data touched:** `src/data/generated/opportunity-data.json`
  md5 still `17cfae825e1de5320705b066effec15b`; `ensure-snapshot` reported
  "existing snapshot present; left untouched".
- **No deployment or public binding** was performed; the server binds
  `127.0.0.1` by default.
- No new dependency was added.
