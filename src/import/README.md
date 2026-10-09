# TVB Opportunity Intelligence — data importer

Read-only importer that turns the Obsidian vault into a typed JSON snapshot for
the frontend.

## Command

```bash
npm run import:data
```

Runs `tsx src/import/cli.ts`. Exits `0` only when every check passes; exits `1`
on a failed check and `2` on a fatal error. **The generated JSON is not written
unless all checks pass.**

## Source and output

| | Path |
|---|---|
| Source vault (READ-ONLY) | `TVB_SOURCE_VAULT` (from a local `.env`) |
| Generated snapshot | `src/data/generated/opportunity-data.json` (repo-relative) |
| Recoverable snapshot | `.vault-snapshot/` (repo-relative) |
| SHA-256 manifests | `.import-manifests/` (repo-relative) |

Paths are defined in `src/import/paths.ts`. The source vault is configured via
the `TVB_SOURCE_VAULT` environment variable — copy `.env.example` to `.env`
(git-ignored) and set it to your vault location. No absolute path is hardcoded
in shared code; the importer fails with a clear message when it is unset.

## Safety behaviour

- The vault is opened **read-only**. No file in it is created, modified, moved,
  renamed, or deleted.
- `.obsidian` workspace metadata is excluded from the snapshot and the
  manifest, because Obsidian rewrites it while open and it holds no records.
- All writes land inside the repository root. The snapshot, the manifests, and
  the generated JSON are all Git-ignored, so source-vault records are never
  committed.
- A SHA-256 manifest of all 45 content files is taken **before** and **after**
  extraction and compared. If any file changed, the import is reported as
  changed and fails.
- Nothing is repaired, defaulted, inferred, or normalised. A malformed record
  raises an error and stops the import rather than being silently fixed.
- Re-running the importer is deterministic: three consecutive runs produced a
  byte-identical file (`47475062…`).

## Architecture

```
src/import/
├── paths.ts      all filesystem locations; vault path is read-only
├── schema.ts     field name/order/kind/required for all 158 fields, from the templates
├── controlled-values.ts  the 44 allowed values, transcribed from the Data Dictionary
├── manifest.ts   SHA-256 manifest build + diff
├── snapshot.ts   recoverable copy of vault content, outside the vault
├── parse.ts      frontmatter + body; date serialisation; per-field gate
├── links.ts      wikilink extraction and exact-ID resolution
├── classify.ts   isFictional rules
├── build.ts      assembles the deterministic snapshot
├── validate.ts   61 integrity, identity, and preservation checks (72 in total, 11 of them Notice-specific)
└── cli.ts        orchestration
src/types/registry.ts      the single authoritative per-type registry
src/types/records.ts       the seven typed record models (six funding types plus Notice)
```

Per-type constants (ID field and prefix, collection key and route segment, vault
directory, singular/plural label, title field, name-marker fields, approved
relationship link fields) live in `src/types/registry.ts` exactly once. Every
other map in the importer and the UI is derived from it, so a new record type is
a one-place change. `assertSchemaConsistency()` runs at importer startup and
refuses to read the vault if the schema, the registry, and the controlled-value
table have drifted apart.

The per-field gate in `parse.ts` (`checkField`) enforces, in order: required
(not blank), controlled value (in its list, or blank), then kind. It throws
rather than repairing, and the message always names the record, the field, and
the reason.

Libraries: `gray-matter` splits frontmatter from body; `yaml` parses the
frontmatter; `tsx` runs the TypeScript CLI.

### Why the `yaml` package rather than gray-matter's default

gray-matter defaults to js-yaml, which turns an unquoted `2026-09-28` into a
`Date`. That is a UTC instant, so serialising it can shift the calendar day
under a negative UTC offset — a silent off-by-one-day bug.

The `yaml` package's default core schema leaves `2026-09-28` a **string**, so a
date can never be reinterpreted and shifted. `toIsoDate()` in `parse.ts` still
handles a real `Date` defensively, comparing the round-tripped components and
**throwing** on a mismatch rather than correcting it.

## Serialization rules

| Source | Snapshot |
|---|---|
| `""` (deliberately blank) | `""` — never `null`, `0`, or "no data" |
| `[]` (empty list) | `[]` — distinct from a blank string |
| absent key | stays absent; a `?` in the type means absent, not blank |
| `2026-09-28` | `"2026-09-28"` (ISO string) |
| `false` | `false` — distinct from blank |
| `[[OPP-001 — …]]` | original string kept verbatim, plus resolved `resolvedId` |
| `related_opportunity` | authoritative Source→Opportunity join |

Frontmatter keys are emitted in **template field order**, not insertion order,
so the JSON is stable and diffable.

## `isFictional` classification

A record is fictional only if an **authored marker** matches. Free text is never
enough, and every decision records which rule fired.

| Rule | Meaning |
|---|---|
| `filename-marker` | Source filename contains a standalone `DEMO` / `FICTIONAL` token |
| `name-field-marker:<field>` | The record's own name field contains that token (`opportunity_name`, `company_name`, `organization_name`, `source_name`) |
| `body-banner` | Body contains the authored banner `FICTIONAL DEMONSTRATION` |
| `demo-link` | A frontmatter link resolves to a record already marked fictional by the rules above |

Marker rules run first; `demo-link` is then applied to whatever is still
undecided, in a fixed two-pass order that cannot loop.

**The trap this avoids:** `ORG-001` through `ORG-004` are real, but their
`contact_information` reads "Not recorded in this demonstration record." A
substring scan across all fields flags all four as fictional, which is wrong.
Only the name fields are scanned, so those four stay real.

`DEMO`/`FICTIONAL` must be a standalone token, so a company named "We
demonstrate solutions" is not misread as demo data.

Current result: **14 real, 11 fictional** — `OPP-005`, `COMP-001..003`,
`MATCH-001..004`, `APP-001..002`, `ORG-005`. No ambiguous cases.

## Relationships

All relationship indexes are keyed by original record ID.

- `sourceToOpportunity` — from `Source.related_opportunity`. **`source_url` is
  never used as a relationship key**; it would drop `SRC-002` and `SRC-004`.
- `organizationToOpportunity` — derived by reversing `Opportunity.provider`,
  because Organization records have no link field in frontmatter.
- `matchToCompany` / `matchToOpportunity` / `matchToApplication`
- `applicationToCompany` / `applicationToOpportunity` / `applicationToMatch`
- `opportunityToSource` — the reverse of `sourceToOpportunity`

A link to a non-record note, such as `[[Data Dictionary]]`, resolves to
`notePath` and is **not** a relationship. Links that resolve to nothing are
kept in `unresolvedLinks` and reported rather than dropped. Current count: 0.

## What the importer deliberately does not do

It does not infer eligibility, verification status, match scores, deadlines, or
application outcomes. It does not create records. It does not write to the
vault. Rendering is out of scope for this phase.
