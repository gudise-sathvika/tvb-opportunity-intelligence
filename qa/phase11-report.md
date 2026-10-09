# Phase 11 — Safe, Reproducible Build Bootstrap

**Date/time:** 2026-10-09, ≈11:03–11:20 IST
**Outcome:** Implemented Option C. A clean checkout (no `.env`, no generated snapshot, no Vault) now
**builds successfully**, seeding the git-ignored snapshot from a committed demonstration fixture.
Verified in a genuinely isolated copy.

---

## 1. Files changed and rationale

| File | Change | Rationale |
|------|--------|-----------|
| `src/import/paths.ts` | Removed the hardcoded `V:\TVB\…` `VAULT_ROOT`. Now loads a local, git-ignored `.env` (via `process.loadEnvFile`, guarded) and reads `process.env.TVB_SOURCE_VAULT`; defaults to `''`. | Requirement 1 — environment-based vault root; no personal path in shared config. |
| `src/import/cli.ts` | Added an actionable error when `VAULT_ROOT` is unset ("no source vault configured… set TVB_SOURCE_VAULT … see .env.example"); imported `node:path`. | Requirement 1/3 — clear failure instead of guessing. |
| `scripts/ensure-snapshot.mjs` | **New.** Build bootstrap: if the target snapshot exists → leave untouched; else copy the committed fixture byte-for-byte; else fail clearly. No vault access. | Requirements 2/3. |
| `package.json` | Added `predev`, `prebuild`, `pretypecheck`, `pretest:data` hooks + `ensure:snapshot`; registered `src/data/bootstrap.test.ts` in `test:data`. | Wire the bootstrap into clean builds; requirement 4. |
| `src/data/bootstrap.test.ts` | **New.** Six focused tests (see §4). | Requirement 4. |
| `.env.example` | **New (tracked).** Documents `TVB_SOURCE_VAULT`; empty placeholder, no personal path. | Requirement 1/4. |
| `.env` | **New (git-ignored).** `TVB_SOURCE_VAULT=<production-vault>` for the dev machine. | Preserve current local behavior (requirement 1). |
| `src/import/README.md`, `src/data/README.md` | Documented env config + the clean-checkout bootstrap. | Requirement 4. |

No application/UI code was touched; `paths.ts` is node-only (not imported by the browser bundle).

## 2. Bootstrap decision logic — and why it cannot touch the production Vault

`scripts/ensure-snapshot.mjs`:
1. `target = src/data/generated/opportunity-data.json`; `fixture = src/data/test-fixtures/opportunity-data.fixture.json` (both repo-relative; overridable **only** via `TVB_SNAPSHOT_TARGET`/`TVB_SNAPSHOT_FIXTURE` for tests).
2. If `target` exists → log and `exit 0` (never overwrites — also confirmed byte-for-byte).
3. Else if `fixture` missing → `exit 1` with an actionable message (no target created).
4. Else parse+shape-validate the fixture; on failure `exit 1`.
5. Else write an exact byte copy of the fixture to `target`.

**Proof it cannot select the production Vault:**
- The script **does not import** `src/import/paths.ts`, so `VAULT_ROOT` is never read.
- It contains **no** reference to the vault name/path — asserted by the test
  `the bootstrap cannot select the production Vault` (`bootstrap.test.ts` checks the script source for
  the vault name, `<vault-path-prefix>`, and `import/paths`).

The committed fixture is the **existing** test asset `src/data/test-fixtures/opportunity-data.fixture.json`
(294 KB, `schemaVersion 1.2.0`, 38 records; already used by 10+ tests via
`src/data/test-fixtures/use-snapshot.ts`). It is a committed, non-sensitive demonstration fixture and
is a **different artifact** from the production generated snapshot (different bytes:
`06713f…` vs `17cfa…`). It is **reused**, not invented.

**Why a fixture *snapshot* rather than a fixture *vault* run through the importer:** the importer
enforces 61 integrity checks plus registry/schema/controlled-value consistency
(`src/import/cli.ts:97`, `validate.ts`), and it writes `.vault-snapshot` + two manifests. Constructing
a hand-authored fixture vault that passes all of that is neither small nor safe within the timebox, and
`cli.ts:127` would rewrite the snapshot. Copying a committed, already-valid snapshot avoids the
validation pipeline entirely and never invokes the importer — the safer choice, per the "do not assume a
fixture vault passes the importer" instruction.

## 3. Failure behavior
- Missing fixture / invalid JSON / wrong shape → non-zero exit with a specific message; **no** target is
  created (no silent empty/fabricated data).
- Unset `TVB_SOURCE_VAULT` → the importer prints an actionable error and exits `2` (does not guess).
- Existing snapshot → left untouched, so regular local builds never regenerate it.

## 4. Tests and results

`src/data/bootstrap.test.ts` (node:test, 6 tests, all pass):
1. seeds the snapshot from the fixture when missing (byte copy);
2. preserves an existing snapshot byte-for-byte;
3. fails clearly when the fixture is missing;
4. fails clearly when the fixture is not valid JSON;
5. fails clearly when the fixture is not a snapshot shape;
6. the bootstrap cannot select the production Vault.

| Command | Result |
|---------|--------|
| `npm run typecheck` | exit 0 (pretypecheck: "existing snapshot present; left untouched") |
| `npx tsx --test src/data/bootstrap.test.ts` | **6 pass / 0 fail** |
| `npm run build` | ✓ built in 2.54s (prebuild no-op; pre-existing >500 kB chunk warning) |
| `npm run test:data` | **354 pass / 0 fail / 0 skip** (was 348; +6 bootstrap tests) |
| `npx tsx -e "import('./src/import/paths.ts')…"` | `VAULT_ROOT = "<production-vault>"`, `exists = true` (env wiring on this machine) |

## 5. Isolated clean-copy build — VERIFIED

Isolated copy at `<temp>/phase11-clean` built with tar, **excluding**
`node_modules`, `.git`, `.vault-snapshot`, `.import-manifests`, `src/data/generated/`, and **`.env`**
(`node_modules` linked from the working repo, no copy). Preconditions confirmed: no `src/data/generated/`
and no `.env`.

- `npm run build` → `prebuild` seeded the snapshot from the committed fixture, then
  `tsc -b && vite build` succeeded: **✓ built in 2.59s** (164 modules; `dist/index-*.js` 806 kB).
- The generated snapshot in the copy is a **byte-for-byte copy of the fixture**
  (`md5 06713f2dcc9a680301eea64e3013e32e` for both).
- Temp copy deleted afterward. The working directory was not altered.

**Conclusion: clean-checkout reproducibility is verified for the build step.**

## 6. Production Vault / generated data — untouched
- `src/data/generated/opportunity-data.json` unchanged: md5 `17cfae825e1de5320705b066effec15b`,
  size 92,613 bytes, mtime `2026-10-09 01:13`.
- `npm run import:data` was **not** run (it would rewrite the snapshot).
- The production Vault (`<production-vault>`) was read-only probed for existence only;
  nothing was written.
- No proposals, applications, bids, or contracts created; no live/external requests; the untracked
  repository was not committed, reset, cleaned, stashed, or overwritten.

## 7. Remaining blockers & limitations
1. **`/__tvb/*` bridge endpoints are still Vite-plugin-only** (`vite.config.ts:5–6,18`: `tvbVaultBridge()`,
   `tvbTedBridge()`, `tvbUsaSpendingBridge()`), active only under `vite dev`/`vite preview`. This phase
   did **not** add a production server host (§ safety: no deployment server/framework).
2. **Seed data is demonstration data without a global in-app banner.** The reused fixture is the
   project's test dataset; the app has no `isFictional`/demo banner in the UI (grep of
   `src/components`, `src/pages` found none). The bootstrap logs a prominent warning and it is documented,
   but a fixture-seeded build should not be presented to stakeholders as production data. I did **not**
   add a UI banner (that would be a product/UI change beyond this phase).
3. **CI/deploy/monitoring** evidence still absent (unchanged from Phase 9).
4. Hostability still requires a non-Vite host for the bridges and (for real data) a vault or a
   generated-at-build snapshot produced in the target environment.
