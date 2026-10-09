# Phase 10 — Reproducible Build Foundation

**Date/time:** 2026-10-09, ≈10:59–11:01 IST (investigation + validation; **no code changed**)
**Outcome:** Root cause confirmed empirically. **No code changes made** — the correct fix requires
an architectural decision (how a build obtains its data), which the phase rules reserve for approval.

---

## 1. Root cause — confirmed by file evidence and a clean-copy build

A clean checkout cannot build because the frontend **statically imports a git-ignored file**:

- `src/data/selectors.ts:18` — `import snapshotJson from './generated/opportunity-data.json'`.
  This is the **only** module that imports the JSON (`src/data/README.md:34`), but it is a static
  import, so TypeScript/esbuild must resolve the file at build time.
- `.gitignore` — `src/data/generated/` is explicitly ignored: *"Generated vault snapshot data
  (produced by `npm run import:data`) … must never be committed."*
- `src/data/README.md:12–21` — the file is *"a build artifact, not a source file"* and is
  *"Git-ignored, because it contains copies of source-vault records."*
- `tsconfig.app.json:15` — `resolveJsonModule: true`, so `tsc -b` type-checks the import (and thus
  requires the file); `tsconfig.app.json:24,26` — incremental app build over `src`.

Consequence: `npm run build` ⇒ `tsc -b` runs first (`package.json:9`) and fails before Vite runs.

**Empirical confirmation (genuine isolated copy).** I extracted the project into
`<temp>/phase10-clean` **excluding** `node_modules`, `.git`,
`.vault-snapshot`, `.import-manifests`, and `src/data/generated/`, linked `node_modules` from the
working repo (no copy), and ran the build:

```
> tvb-frontend@0.1.0 build
> tsc -b && vite build
src/data/selectors.ts(18,26): error TS2307: Cannot find module './generated/opportunity-data.json'
   or its corresponding type declarations.
```

The build failed at `tsc -b`; `vite build` never ran. The temporary copy was deleted afterward; the
working directory was not altered.

## 2. Why the second half (hardcoded Vault path) matters too

- `src/import/paths.ts` — the vault root was read from `TVB_SOURCE_VAULT` (at this phase `'<production-vault>'`).
  This is Windows-only and machine-specific, so `npm run import:data` (`package.json:16` →
  `tsx src/import/cli.ts`) cannot regenerate the snapshot on any other host or on Linux CI
  (`src/import/README.md:20,25`).
- Precedent for parameterization already exists in the codebase: the **write** bridge reads
  `process.env.TVB_VAULT_ROOT` (`src/vault-bridge/plugin.ts:66`; message in
  `src/vault-bridge/handler.ts:139`). The **import** path does not.

## 3. Where the Vault is actually required

| Path | Needs the local Vault? |
|---|---|
| `npm run build` / `tsc -b` / `vite build` | **No, directly** — only needs the *generated JSON* to exist. |
| `npm run import:data` (`import/cli.ts`, `build.ts`, `snapshot.ts`, `manifest.ts`) | **Yes** — reads `VAULT_ROOT` read-only. |
| Import validation tests (`schema-validation.test.ts`, `procurement-match.test.ts`) | **Yes** — they call `buildSnapshot(VAULT_ROOT)` against the real vault. |
| Runtime app (`selectors.ts` and UI) | **No** — reads the already-generated JSON statically. |
| Write bridge (preview/write) | Uses `TVB_VAULT_ROOT` env (already parameterized). |

So build-time requirements are cleanly separable from the local-vault import step — but the current
wiring does not express that separation.

## 4. Decision — no code changes (architectural choice required)

Every viable fix changes the deliberate data-governance model ("the vault is the source of truth;
generated data is never committed"). The options:

**Option A — Commit a non-sensitive empty snapshot at the generated path (un-ignore it).**
- Pros: clean build works immediately; no new deps; honest "no records" UI.
- Cons: breaks the "never commit generated data" rule; the tracked file and the local artifact
  collide, so `git checkout`/`git clean` could **overwrite real local data** (data-loss hazard);
  changes provenance/source-of-truth semantics. Not safe without further guardrails.

**Option B — Committed fallback snapshot at a new path + a resolver that prefers the real file.**
- Pros: never commits real data; clean build works; fallback clearly a demo/empty set.
- Cons: architectural — needs a virtual/alias module (`tsconfig` `paths` + Vite `resolve.alias`) and
  `import.meta.glob` (Vite-only) or a shim, plus type strategy; touches `selectors.ts` and build
  config.

**Option C — Generate at build time from a committed fixture vault (recommended).**
- Parameterize `VAULT_ROOT` via `process.env.TVB_SOURCE_VAULT ?? default` (mirrors the existing
  `TVB_VAULT_ROOT` precedent), commit a small schema-valid **fixture** vault, and add a `prebuild`
  that runs the importer against the fixture **only when the real snapshot is absent**.
- Pros: preserves "never commit generated data" and "vault is source of truth"; reproducible on any
  host/CI; real local data untouched (present ⇒ skipped).
- Cons: largest option — the fixture must satisfy the importer's 72 validation checks and the
  registry/controlled-value assertions; likely exceeds a safe 20-minute change.

**Option D — Make the snapshot optional and add an explicit empty state.**
- Cons: architectural; changes the data layer and UI empty states; risks masking a genuinely missing
  import instead of failing loudly. Not preferred.

**Recommendation:** implement **Option C** (with the env-parameterized `VAULT_ROOT` as its first,
independently-safe step) after approval. **Option A is rejected** — the tracked-vs-ignored collision
endangers the user's real local data.

## 5. Commands executed and results

| Command | Result |
|---|---|
| Clean-copy `npm run build` (isolated, no `src/data/generated/`) | **FAIL** — `error TS2307: Cannot find module './generated/opportunity-data.json'` at `selectors.ts:18` (root cause reproduced) |
| `npm run typecheck` (working dir) | exit 0, no errors |
| `npm run build` (working dir) | ✓ built in 2.71s (pre-existing >500 kB chunk warning only) |
| `npm run test:data` (working dir, focused incl. `selectors.test.ts`) | **348 pass / 0 fail / 0 skip** (2.7s) |

## 6. Clean-checkout reproducibility — status

- **Root cause reproduced from a genuinely isolated copy: YES** (the clean build fails exactly as
  predicted).
- **A fixed clean build was NOT verified, because no fix was implemented.** There is no code change
  to validate. This limitation is explicit, per the phase rules.

## 7. Remaining blockers for hostability

1. Generated snapshot is git-ignored yet statically imported (this phase's subject) — unresolved by
   decision, awaiting approval of Option C.
2. `VAULT_ROOT` is a hardcoded Windows path (`src/import/paths.ts:17`) — not yet env-parameterized.
3. **The `/__tvb/*` bridge endpoints are Vite-plugin-only** — mounted as
   `tvbVaultBridge()`, `tvbTedBridge()`, `tvbUsaSpendingBridge()` in `vite.config.ts:5–6,18`, active
   only under `vite dev`/`vite preview`. No production server host exists, so live-source and write
   features 404 on static hosting.
4. No CI config, container, or deployment/monitoring evidence (unchanged from Phase 9).

## 8. Safety confirmation

- **No application or test code was changed**; `package.json`, `.gitignore`, `vite.config.ts`,
  `selectors.ts`, `paths.ts`, and every test file are byte-identical to their Phase 9 state.
- **`src/data/generated/opportunity-data.json` was not modified** — size 92,613 bytes and mtime
  `2026-10-09 01:13` unchanged.
- **The production Vault (`<production-vault>`) was not written to**; the importer
  was never run.
- No proposals, applications, bids, or contracts were created; no live/external requests were made.
- The untracked repository was not committed, reset, cleaned, stashed, or overwritten; the isolated
  temp copy was deleted.
- Only this file was written: `qa/phase10-report.md`.
