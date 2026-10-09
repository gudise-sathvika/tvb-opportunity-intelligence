# src/data

Two things live here.

## `README.md`

Notes for the import phase, including the serialization rules that the importer
must honour. Kept for reference.

## `generated/`

Output of `npm run import:data`. Git-ignored, because it contains copies of
source-vault records.

| File | Produced by |
|---|---|
| `generated/opportunity-data.json` | `npm run import:data` (phase 3) |

This file is a **build artifact**, not a source file. Edit the vault, not this
JSON. Re-run the importer after any vault change; the importer recomputes it
deterministically and re-validates against the source.

### Schema

The snapshot contains the six record collections, original record IDs, parsed
frontmatter in template field order, verbatim Markdown bodies, `isFictional`
classification with the rule that fired, resolved link metadata, ID-keyed
relationship indexes, and any unresolved links.

Types: `src/types/records.ts` (`VaultSnapshot`).

### How the app reads it

`src/data/selectors.ts` is the only module that imports the JSON. Every UI
component reads through those pure functions, never the snapshot object
directly, so there is one place where the generated shape is narrowed to the
UI's `RecordRow` type.

Two rules the selectors enforce, because the UI depends on them:

1. **Blank, empty list, and absent are three different things.** `field()`
   returns `undefined` for a missing key and `""` for a deliberately empty one;
   `listField()` returns `[]` for an empty list. The UI renders each differently
   and never collapses them.
2. **Relationships come from the importer's indexes only.** No selector matches
   on names or URLs, so the UI and the importer cannot disagree.

Run the tests with `npm run test:data`.

### When importing from a different vault

Set `TVB_SOURCE_VAULT` in a local `.env` (see `.env.example`). The importer
reads only the six record directories listed in `src/import/schema.ts`
(`RECORD_DIRS`) and never writes into the source.

### Clean-checkout bootstrap

`src/data/generated/` is git-ignored. On a clean checkout,
`node scripts/ensure-snapshot.mjs` (wired to `prebuild`, `predev`, and
`pretypecheck`) copies the committed demonstration fixture at
`src/data/test-fixtures/opportunity-data.fixture.json` into the generated path
**only when it is missing**. It **never overwrites an existing snapshot** and
**never reads the production vault**. The seeded snapshot is demonstration/test
data; run `npm run import:data` with `TVB_SOURCE_VAULT` set for real data.
