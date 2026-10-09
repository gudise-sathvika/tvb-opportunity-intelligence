# Phase 20A Report — Audit Before Cleanup

Status: **Complete (audit only).** No files were deleted, staged, committed,
pushed, reset, or changed; no remotes were modified; the production Vault and the
generated snapshot were not touched; no live external API calls were made.

Timebox: completed within the 20-minute budget.

---

## 1. Verified Git state

| Fact | Observed value |
|---|---|
| Repository root (`git rev-parse --show-toplevel`) | `<repo-root>` |
| Current branch | `master` |
| Commit state | **No commits yet** (`git log -1` → `fatal: your current branch 'master' does not have any commits yet`) |
| Remotes (`git remote -v`) | **none configured** |
| Upstream | **none** (`@{u}` → `fatal: no such branch: 'master'`) |
| Workspace dir `<production-vault>` | **Not a git repository** — this is the production Vault; untouched |
| `.gitignore` | present (59 lines) |
| `.env.example` | present (only `TVB_SOURCE_VAULT=`) |
| Lockfile | `package-lock.json` present (88 KB, untracked) |
| Tracked files | **zero** — every candidate is untracked (`??`) |

So: the repo exists at `<repo-root>`, has **no history and no GitHub
remote**. Both facts must be created before any push. `git add .` would add
**290 files**; this must be reviewed first (see §2).

`.gitignore` currently ignores: `node_modules/`, `dist/`, `dist-ssr/`, `build/`,
`logs/`, `*.log`, `.vscode/*`, `.idea/`, `.DS_Store`, `*.tsbuildinfo`, `.env`,
`.env.local`, `.env.*.local`, `src/data/generated/`, `.vault-snapshot/`,
`.import-manifests/`, `qa/.artifacts/`, `qa/screenshots/`, `qa-run-*.log`,
`.phase5-baseline.txt`, `powershell.exe`.

---

## 2. File-category audit

### 2a. Belongs in the repository (commit candidates)
Source (`src/`), tests (`src/**/*.test.ts`, `qa/*.spec.ts`), scripts
(`scripts/`), server (`server/`), config (`package.json`, `package-lock.json`,
`tsconfig*.json`, `vite.config.ts`, `playwright.config.ts`, `index.html`), docs
(`README` files), QA reports/deliverables (`qa/phase*.md`,
`qa/funding-discovery-audit.md`), and the committed demonstration fixture
(`src/data/test-fixtures/opportunity-data.fixture.json`, 294 KB).

### 2b. Generated / cache / artifact (git-ignored — will NOT be committed)
Present in the working tree and safe to leave or delete locally at any time:
`node_modules/`, `dist/`, `qa/.artifacts/`, `qa/screenshots/`,
`src/data/generated/` (the protected snapshot), `.vault-snapshot/` (131 files —
recoverable copies of vault content), `.import-manifests/` (2 files),
`.phase5-baseline.txt`. These are all covered by `.gitignore`. **Do not delete
`.vault-snapshot/` or `.import-manifests/` if they are your only backups of
import provenance — that is a user decision, not this phase's.**

### 2c. Untracked but NOT ignored → would be committed by `git add .`
- `qa/phase19c-dashboard-dark.png` (256 KB)
- `qa/phase19c-dashboard-light.png` (255 KB)

These are Phase-19C screenshots (no `phase19c-report.md` exists). They are QA
artifacts, not source. Either remove them or add an ignore rule (`qa/*.png`)
before staging. **Risk: low — binary noise, no data.**

### 2d. Sensitive / privacy items
- **`.env` (ignored, will not be committed)** contains `TVB_SOURCE_VAULT`
  pointing at the absolute local **production Vault** path (value withheld).
  Confirmed ignored by `.gitignore` line 32; must remain so.
- **`.env.example`** is clean (empty value).
- **Absolute local paths leaked into commit candidates:** `start-preview.ps1`
  (hardcoded `<repo-root>` and `<user>\...\Temp\...`), `src/import/README.md`
  (`<repo-root>\...`), and several `qa/*.md` reports (≈10× `<repo-root>`,
  3× `<repo-root>`, 2× `<user>`). **These are not secrets**, but they expose
  the developer's username and private local layout in a public repo. Decide
  whether to scrub before pushing.
- **Fixture metadata** `src/data/test-fixtures/opportunity-data.fixture.json`
  embeds a `source` object naming the private vault: `vaultDirectoryName:
  "TVB Opportunity Intelligence"`, `contentFileCount: 131`, `recordCount: 38`,
  `totalSchemaFields: 238`. The fixture body contains **10** records (a
  demonstration subset; note the 38-vs-10 metadata mismatch). Confirm the 10
  records are genuinely non-sensitive demo data before a public push.
- **`powershell.exe`** — a 495 KB PE32+ Windows binary sitting in the repo root
  (ignored by `.gitignore`). It is an abandoned workaround artifact and should
  not be shipped; safe to delete locally. It is ignored, so it will not be
  committed.

### 2e. Missed / candidate ignore rules
- Add `qa/*.png` (or `qa/phase19c-*.png`) to catch the two screenshot artifacts.
- Consider whether `start-preview.ps1` (machine-specific) should be committed,
  genericised, or ignored.
- No required file is currently trapped by an ignore rule: the fixture lives in
  `src/data/test-fixtures/`, a different directory from the ignored
  `src/data/generated/`. Verify on first `git add -n`.

### 2f. Known technical risks (from prior reports)
- **Server security boundary** (`server/app.ts`, `server/config.ts`): binds
  loopback by default, **no authentication**; only origin allowlisting, rate
  limiting, concurrency gating, and a request timeout protect the bridges.
  `TVB_ALLOW_NON_LOOPBACK` prints an explicit warning. The Vault-**write** route
  is intentionally **unmounted** on the standalone host.
- **Funding-source semantics:** USAspending (`SU-US-001`) returns **obligated
  award history**, not open solicitations (`qa/funding-discovery-audit.md`).
- **Grants.gov (`SU-GRANTS-001`):** bridge added in Phase 19B but the source is
  registered `accessState: 'UNKNOWN'` — **not yet verified live**, not wired into
  the Discovery store/UI, and the endpoint's rate-limit/fair-use terms are
  unread.
- **TED:** title-only keyword matching; valid empty results are `NO_RESULTS`, not
  failures.

---

## 3. Test baseline (commands actually run in this phase)

All commands are non-destructive and offline; no live external API call was
made.

| Command | Result |
|---|---|
| `npm run test:vault` | **37 passed / 0 failed** |
| `npm run test:data` | **354 passed / 0 failed** |
| `npm run test:automation` | **319 passed / 0 failed** |
| `npm run test:live` | **73 passed / 0 failed** |
| `npm run typecheck` (`tsc -b`) | **clean, no errors** |
| `npm run build` | **succeeded in 5.43s** |
| `npm run test:qa` (Playwright) | **367 passed / 3 skipped / 0 failed** (4.8m) |

Integrity: `src/data/generated/opportunity-data.json` md5 unchanged
`17cfae825e1de5320705b066effec15b` after all runs.

**Failures:** none. **Commands not run:** none of the defined verification
scripts were skipped. `npm run import:data` was intentionally **not** run (it
would rewrite the protected snapshot from a live vault). No live-source smoke
was run.

**Preconditions to reproduce the baseline on a clean checkout:**
1. `npm ci` (uses the committed `package-lock.json`).
2. `npm run build` (its `prebuild` hook seeds the git-ignored snapshot from the
   committed fixture) **before** `npm run test:qa` — the Playwright webServer
   serves `dist/` via `vite preview` and does **not** build. Playwright's QA
   vault is an isolated `qa/.artifacts/vault-bridge-vault`, never production.

---

## 4. Cleanup candidates (identified only — nothing removed)

| Candidate | Why safe to remove |
|---|---|
| `powershell.exe` (root) | Abandoned 495 KB binary; ignored; not referenced by any script |
| `qa/phase19c-dashboard-*.png` | QA screenshots; regenerable; should be ignored instead of committed |
| `dist/`, `qa/.artifacts/`, `qa/screenshots/` | Rebuildable outputs |
| `*.tsbuildinfo`, `.phase5-baseline.txt` | Local incremental/baseline scratch |
| **Keep** `.vault-snapshot/`, `.import-manifests/`, `src/data/generated/` | Ignored; may be the user's local backups — do not delete without consent |

---

## 5. Prioritized fix & cleanup plan

1. **Add ignore rules** for `qa/*.png`; decide the fate of `start-preview.ps1`.
2. **Decide on the two screenshot PNGs** — remove or ignore (do not commit).
3. **Scrub or accept** local absolute paths in `start-preview.ps1`,
   `src/import/README.md`, and `qa/*.md`.
4. **Confirm the fixture is non-sensitive** (10 demo records; private-vault name
   in `source` metadata) and reconcile the 38-vs-10 metadata mismatch.
5. **Create the GitHub remote and initial commit** (see §6).
6. Post-push follow-ups (out of scope here): verify Grants.gov live and promote
   `SU-GRANTS-001` to `AVAILABLE`; wire the Grants.gov store/UI; harden server
   auth if ever exposed beyond loopback.

## 6. Conditions required before committing and pushing

- [ ] `start-preview.ps1` path leak resolved (scrubbed, genericised, or ignored).
- [ ] `qa/phase19c-dashboard-*.png` removed or ignored.
- [ ] Fixture confirmed non-sensitive; metadata mismatch explained.
- [ ] `.env` confirmed still ignored and **absent** from `git status`
      (`git status --ignored --short` shows `!! .env`, i.e. never staged).
- [ ] `src/data/generated/opportunity-data.json` confirmed ignored and unchanged
      (md5 `17cfae825e1de5320705b066effec15b`).
- [ ] `.vault-snapshot/`, `.import-manifests/`, `dist/`, `node_modules/`,
      `qa/.artifacts/` all confirmed ignored.
- [ ] Full baseline green (§3) on the exact tree being committed.
- [ ] A GitHub remote added **by explicit user instruction**, and a human-reviewed
      `git add` file list (290 candidates) before the first commit.

## Blockers

The repository has **no commits and no remote**, so "push to GitHub" cannot begin
until a remote is configured and the initial commit is made — both require
explicit user authorization. The local path/username leaks and the Phase-19C
screenshot artifacts are the only file-hygiene items that should be resolved
first. No test failures or snapshot drift were found.
