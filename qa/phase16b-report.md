# Phase 16B Report — TED Zero-Results Diagnostic

Status: **Diagnostic complete.** No production code, candidate, Vault, or
generated data was changed. No live TED request was made. The zero-candidate
result is explained by how the live run builds its search term, not by a bug in
response handling: the run used the two **company names** as TED title-search
terms, and TED's title field contains no notices matching those strings in the
default window, so the source legitimately returned zero notices, which is a
valid `SUCCESS` with zero candidates.

Timebox: completed within the 15-minute budget.

## Confirmed facts (from code, deterministic)

1. **The search term is the company name when no keyword is entered.** The
   Discovery panel passes company *names* (`src/data/company-directory-names.ts`)
   to the live store: `liveDiscoveryStore.runCompany(context, companyName)`
   (`src/pages/Discovery.tsx:117,127`). The store resolves the term as
   `context.keyword !== '' ? context.keyword : companyId`
   (`src/live-source/live-discovery.ts:172-174`). With no keyword typed, the term
   is the company name verbatim.

2. **The TED query searches only the notice title.** The planner emits
   `notice-title~"<term>" AND publication-date>=<YYYYMMDD>`
   (`src/automation/ted-adapter.ts:168-169`), where `~` is the title-field
   contains match. Buyer names live in `organisation-name-buyer`, **not** in
   `notice-title`, so a company/buyer name is generally the wrong field to match.

3. **The default window is "today minus 90 days"** (`TED_LIVE_WINDOW_DAYS = 90`,
   `live-discovery.ts:50,244`), so the two conditions are ANDed.

4. **Exact payload constructed offline today** (no network; `buildTedQueryPlan` +
   `buildTedSearchBody` with `limit: 10`, default 90-day `publishedSince =
   20260711`):
   - ContextQA →
     `{"query":"notice-title~\"ContextQA\" AND publication-date>=20260711","page":1,"limit":10,"fields":[...]}`
   - Columbia Basin College →
     `{"query":"notice-title~\"Columbia Basin College\" AND publication-date>=20260711","page":1,"limit":10,"fields":[...]}`

5. **No candidate-discarding filter applies here.** `runCompany` filters
   candidates with `matchesKeyword(candidate, context.keyword)`
   (`live-discovery.ts:281`); `matchesKeyword` returns `true` for every candidate
   when `context.keyword === ''` (`live-discovery.ts:124-127`). With no keyword
   typed, nothing is filtered downstream — the zero comes from the source
   response itself.

6. **A valid empty response is represented honestly.** A well-formed HTTP 200
   with `notices: []` (and `totalNoticeCount: 0`) parses to `results: []` and
   `errors: []` → `SUCCESS` with zero results (adapter state rule
   `src/automation/adapter.ts:37-40`; parse `ted-adapter.ts:266-329`). Distinct
   from:
   - non-JSON body → `adapter_error` (never a silent empty success;
     `ted-adapter.ts:249-256`);
   - a body with no `notices` array → `adapter_error`
     (`ted-adapter.ts:258-264`);
   - a source-side timeout that matched `totalNoticeCount > 0` but returned no
     notices → `adapter_error` (`ted-adapter.ts:270-281`);
   - non-2xx / 429 / 401 / 403 → explicit errors/BLOCKED
     (`ted-adapter.ts:381-420`).
   So "valid zero" cannot be confused with "malformed" or "truncated".

7. **The recorded successful Phase U/4 evidence is a thematic keyword, not a
   company name.** The byte-for-byte recording (`src/automation/ted-fixture.ts`)
   was captured with `notice-title~"solar energy" AND publication-date>=20260801`
   and returned `totalNoticeCount: 43` (3 notices). `qa/phase4-report.md`'s real
   end-to-end run also used keyword `solar energy` and returned 10 notices. Broad
   themes match titles; company names do not.

## Most likely cause (hypothesis, strongly supported)

The operator selected two companies and left the keyword blank, so each company
was searched with its **name** as a title-only contains term over the last 90
days. No EU tender notice title contains "ContextQA" or "Columbia Basin College",
so TED returned a valid empty result set and the run correctly reported `SUCCESS`
with zero candidates. This is expected behavior for those inputs, not a failure.

Supporting (secondary) contributors, all confirmed above: the term is matched
against `notice-title` only (buyer names are in a different field), and the
90-day window further narrows the space.

## What could NOT be confirmed offline

- **The exact payload/response of that specific run.** Run history and
  source-detail live only in the in-memory store (`liveDiscoveryStore.history()`),
  so the literal request/response bytes from the reported run are not persisted
  and cannot be re-read. The payloads in fact (4) are the deterministic
  construction for those inputs, not a capture of the run.
- Whether a keyword was actually typed. If one was entered, both companies would
  share that single term; the fact that **both** named companies returned zero is
  consistent with the empty-keyword/company-name case but does not, by itself,
  rule out an unusual keyword.

## Smallest recommended next step

Do not change code yet. First, confirm the input with zero live calls: check
whether a keyword was entered on that run; if it was blank, this is the
company-name-against-title issue and the finding is complete. If desired, capture
the next run deterministically by recording the bridge request body and the
source's `status`/`totalNoticeCount` (an offline diagnostic), then decide — with
explicit approval and as a deliberate product decision — whether company-name
discovery should target `organisation-name-buyer` and/or require an explicit
business keyword instead of falling back to the company name. No filter should be
loosened speculatively.

## Safety confirmation

- **No code changed.** Only `qa/phase16b-report.md` was created; the temporary
  offline query-builder snippet was deleted immediately.
- **No live TED request** was made (no `createFetchTransport` call).
- **No candidates, Vault records, applications, or generated data changed.**
  `src/data/generated/opportunity-data.json` md5 still
  `17cfae825e1de5320705b066effec15b`.
