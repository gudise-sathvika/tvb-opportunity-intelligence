# Phase 16 Report — Server Lifecycle and Health Controls

Status: **Implemented and verified.** The standalone host now exposes minimal
liveness/readiness endpoints and performs a single bounded graceful shutdown on
`SIGINT`/`SIGTERM`. All Phase 14/15 boundaries are preserved (bridge-only read
routes, origin policy, bounded rate limit, size cap, timeout, bounded
concurrency, loopback default). No dependency was added, nothing was deployed,
no external request was made, and no Vault write or generated-data change
occurred.

Timebox: implemented within the phase budget (final `test:qa` ran slightly over
the 20-minute mark).

## Files changed

New:
- `server/lifecycle.ts` — `HostLifecycle` (ready / shutting-down flags) and
  `createShutdownController(options)`: idempotent shutdown (mark not ready →
  `server.close()` stops accepting → poll the concurrency gate until in-flight
  drains or `drainMs` elapses → `server.closeAllConnections()` → resolve
  `ShutdownEvidence`). Duplicate signals share the one in-progress promise.
- `server/lifecycle.test.ts` — 3 deterministic shutdown tests.

Changed:
- `server/app.ts` — added `AppOptions.lifecycle` / `AppOptions.gate` (injectable
  shared state) and a reserved `/health/*` namespace handled **before** any
  bridge/static logic:
  - `GET /health/live` → `200 { "status": "live" }`.
  - `GET /health/ready` → `200 { "status": "ready" }` when ready, else
    `503 { "status": "not_ready" }`.
  - Other `/health/*` → `404` JSON; non-GET → `405 Allow: GET`.
  - Bodies carry only `status` (no config, paths, env, creds, or Vault info);
    the handler never calls the bridges, network, or filesystem.
- `server/config.ts` — new validated `drainMs` (`TVB_DRAIN_MS`, default 5000,
  range 100–60000); added to `HostConfig`.
- `server/serve.ts` — `createProductionServer` now returns
  `{ server, lifecycle, gate, shutdown }`; `main()` installs `SIGINT`/`SIGTERM`
  handlers calling the single controller; `onExit` records the exit code and
  forces termination after a short 250 ms settle delay (avoids a Windows libuv
  teardown assertion from exiting synchronously mid-close); startup log now
  includes `drainMs` and marks the rate limit per-process.
- `server/app.test.ts` — 2 new tests (health endpoints upstream-free/leak-free;
  readiness flips to `not_ready`).

Unchanged: both handlers, both contracts, `http-boundary.ts`,
`fetch-transport.ts`, `concurrency.ts`, `rate-limit.ts`, `vite.config.ts`, Vite
plugins, and all Vault modules. The Vault-write bridge is still not mounted.

## Behavior implemented

- **Liveness:** process-responding probe with no dependencies.
- **Readiness:** reflects `HostLifecycle`; flips to `not_ready` (503) the moment
  shutdown begins — no fake-ready reporting.
- **Graceful shutdown:** on first signal — mark not ready, `server.close()`
  (refuse new connections), drain in-flight up to `drainMs`, then
  `closeAllConnections()` and exit. Forced termination is guaranteed by the
  deadline plus the `onExit` fallback timer; concurrency slots are released by
  the existing `finally` in the bridge handler.
- **Idempotent:** a second `SIGINT`/`SIGTERM` returns the same shutdown promise
  and logs "already in progress"; `onExit` fires once.

## Test evidence

New/lifecycle tests (`server/lifecycle.test.ts`):
- **Drain within bound:** an in-flight request is held, shutdown is invoked,
  readiness is false and `server.listening` becomes false, then the request
  completes `200`; evidence `{drained:true, forced:false, inFlightAtStart:1}`;
  gate `inFlight` returns to 0; `onExit` called once; a subsequent request is
  refused (`assert.rejects`).
- **Deadline enforced:** a never-resolving handler with `drainMs:100` →
  evidence `{drained:false, forced:true, inFlightAtStart:1}` and shutdown
  resolved in well under the safety bound (no hang).
- **Duplicate signals:** `SIGTERM` + `SIGINT` return the same evidence object;
  exactly one "already in progress" log; `onExit` once.

Health tests (`server/app.test.ts`):
- `GET /health/live` → 200 `{status:"live"}`; `GET /health/ready` → 200
  `{status:"ready"}`; both bridge counters remain **0** (no upstream).
- `GET /health/other` → 404 JSON; `POST /health/live` → 405.
- After `lifecycle.markNotReady()`, `/health/ready` → 503
  `{status:"not_ready"}`.
- Body key set asserted to be exactly `["status"]` (no sensitive fields).
- Vault route `/__tvb/vault/write` still → 404 and no server file imports the
  vault bridge/writer.

Exact commands and results (2026-10-09):
- `npx tsx --test server/*.test.ts` → **32 pass / 0 fail**.
- `npm run test:live` → **63 pass / 0 fail** (58 prior + 5 new).
- `npm run typecheck` → exit **0**.
- `npm run build` → **✓ built in 5.13s**.
- `npx playwright test` → **364 passed / 3 skipped / 0 failed** (unchanged).

## Local smoke test (no external requests; not a deployment)

`createProductionServer` started on `127.0.0.1:4181` with a built `dist/`:
- `GET /health/live` → `200 {"status":"live"}`.
- `GET /health/ready` → `200 {"status":"ready"}`.
- `POST /__tvb/vault/write` → `404`.
- `GET /health/nope` → `404`.
- `shutdown('SIGTERM')` logged
  `received SIGTERM; refusing new connections and draining up to 1000ms` then
  `all in-flight requests drained`; evidence `{drained:true, forced:false,
  inFlightAtStart:0}`; `isReady()` → false; process exited cleanly (exit 0) with
  no libuv teardown assertion after the deferred exit.

Note: real OS signal delivery could not be exercised on this Windows host
(`kill -TERM` is not delivered as a Node signal); the shutdown controller is
platform-independent and is covered directly by the deterministic tests above.

## Known limitations

- **Not production-ready.** Auth is absent: origin allowlisting, rate limiting,
  and concurrency limits are abuse controls, **not** authentication.
- Rate limiting is **in-memory and per process** (not distributed).
- No TLS (terminate at a reverse proxy); no trusted-proxy handling
  (`req.socket.remoteAddress` only; forwarded headers are not trusted).
- Graceful draining is best-effort and bounded by `drainMs`; after the deadline
  connections are forcibly closed. Drain is not claimed as guaranteed.
- Still run via `tsx` (project tsconfigs are `noEmit`); no compiled artifact, no
  deployment/CI, no monitoring.
- Health endpoints report process readiness only; they do not probe upstream
  sources (by design).

## Assurance

- **No public binding/deployment:** loopback `127.0.0.1`; public bind still
  requires the explicit `TVB_ALLOW_NON_LOOPBACK=1` opt-in.
- **No live discovery/external HTTP:** all tests mock the transport; smoke
  requests hit only local health/static/vault-404 paths.
- **No Vault writes; Vault bridge not mounted:** `/__tvb/vault/*` → 404 and no
  `server/*.ts` imports the vault bridge/writer.
- **No protected-data change:** `src/data/generated/opportunity-data.json` md5
  still `17cfae825e1de5320705b066effec15b`; `ensure-snapshot` left it untouched.
- No new dependency was added.
