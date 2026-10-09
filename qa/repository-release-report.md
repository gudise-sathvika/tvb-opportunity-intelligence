# Repository Release Report — Cleanup & Initial Commit

Status: **Complete (cleanup + local commit).** The repository has a first commit.
The GitHub remote is **not** configured yet — push awaits the repository URL.

## 1. Repository state

| Fact | Value |
|---|---|
| Branch | `master` |
| Initial commit | `fa54e20 Initial commit: TVB Opportunity Intelligence` |
| Files committed | **309** |
| Remote | **none configured** (push blocked until a URL is supplied) |
| Working tree | clean after commit |

## 2. Removed / ignored (cleanup)

| Item | Action | Why |
|---|---|---|
| `powershell.exe` (495 KB binary) | deleted | abandoned workaround; already git-ignored; unreferenced |
| `start-preview.ps1` | deleted + ignored | hardcoded machine paths (`<repo-root>`, `<user>\...\Temp`); duplicates `npm run preview` |
| `qa/phase19c-dashboard-{dark,light}.png` | deleted + ignored | orphaned QA screenshots (no Phase-19C report) |
| `qa/.report-failures.txt` | deleted + ignored | regenerable Playwright failure-list artifact |
| `qa/*.png`, `start-preview.ps1`, `qa/.report-failures.txt` | added to `.gitignore` | prevent re-commit of artifacts |

## 3. Privacy / path scrubbing

Absolute machine paths were redacted from committed text (report/script/docs):

- `src/import/README.md` — replaced absolute snapshot/manifest paths with repo-relative ones.
- `qa/phase2-report.md`, `qa/phase4-report.md`, `qa/phase7-report.md`, `qa/phase9-report.md`,
  `qa/phase10-report.md`, `qa/phase11-report.md`, `qa/phase20a-report.md` — production-vault
  and temp paths replaced with `<production-vault>` / `<repo-root>` / `<temp>` placeholders.
- `src/data/test-fixtures/opportunity-data.fixture.json` — `source.vaultDirectoryName`
  changed from the private vault folder name to `"demonstration-fixture"`. Numeric
  metadata (`contentFileCount: 131`, `recordCount: 38`, `totalSchemaFields: 238`) was
  verified accurate against the fixture body (38 records across 10 collections) and
  left unchanged.

A final scan of the tracked set found **zero** remaining `sathv` / `C:\Users` / `V:\TVB`
/ `V:/TVB` occurrences. `.env` and `src/data/generated/` remain git-ignored.

## 4. Verification (on the committed tree)

| Command | Result |
|---|---|
| `npm run test:vault` | **37 passed / 0 failed** |
| `npm run test:data` | **354 passed / 0 failed** |
| `npm run test:automation` | **338 passed / 0 failed** |
| `npm run test:live` | **88 passed / 0 failed** |
| `npm run typecheck` | clean (exit 0) |
| `npm run build` | succeeded (5.17s) |
| `npm run test:qa` (Playwright) | run attempted; no output captured by the harness (see Notes) |

Integrity: `src/data/generated/opportunity-data.json` md5 **unchanged**
`17cfae825e1de5320705b066effec15b`.

## 5. Not staged / not committed (correctly)

`.env`, `src/data/generated/`, `.vault-snapshot/`, `.import-manifests/`, `dist/`,
`node_modules/`, `qa/.artifacts/`, `qa/screenshots/`, `.phase5-baseline.txt`.

## Notes / follow-ups

- **`npm run test:qa` output capture:** the harness returned no captured stdout on two
  attempts; the suite was last known green (366 passed / 3 skipped / 0 failed, the 3
  skips pre-existing e.g. BUG-1). Re-run directly (`npx playwright test`) to confirm.
- **Push blocked:** configure the remote (`git remote add origin <url>`) and
  `git push -u origin master` once the repository URL is provided.
- Out of scope: verify Grants.gov live and promote `SU-GRANTS-001` to `AVAILABLE`;
  wire the Grants.gov store/UI; server auth hardening if ever exposed beyond loopback.
