# TVB Opportunity Intelligence

A read-only web frontend for a **TVB Opportunity Intelligence** Obsidian vault.
It turns a folder of Markdown records (opportunities, matches, applications,
companies, organizations, sources, notices, bids, contracts) into a typed,
browsable, searchable application — and can augment that snapshot with **live**
public funding/tender discovery.

> Design rule: the production vault is the source of truth and is opened
> **read-only**. Nothing is invented, repaired, or written back to the vault
> without an explicit, human-approved write step.

## Features

- **Browse & detail views** for every record type, with cross-linked
  relationships (opportunity ↔ match ↔ application ↔ company ↔ organization ↔
  source, and notice ↔ bid ↔ contract).
- **Dashboard / analytics** with workflow grouping and deadline buckets.
- **Discovery** — run automated searches over public sources and hand the raw
  candidates to a Human review queue.
- **Review workflow** — approve/reject discovered candidates; approved records
  can be proposed as vault writes (preview first, then an isolated write).
- **Live sources** (same-origin bridges, public/no-auth):
  - **TED** — EU public procurement notices.
  - **Grants.gov** — US federal funding opportunities.
  - **USAspending** — US obligated award history (context, not open calls).
  - **EU Funding & Tenders (SEDIA)** — HORIZON/H2020 grant topics and cascade
    funding calls.
- **Fixture mode** — a committed demonstration snapshot so the app builds and
  runs on a clean checkout with no vault present.

## Tech stack

- **React 19** + **React Router 7**, built with **Vite 6**.
- **TypeScript** (project references: `tsconfig.app`, `.automation`, `.import`,
  `.node`).
- **Node.js** test runner via **tsx** for unit/integration tests.
- **Playwright** for browser end-to-end tests.
- A small **Node.js production host** (`server/`) that serves the built app and
  mounts the read-only live bridges behind a hardened same-origin boundary.

## Getting started

### Prerequisites

- Node.js 20+ and npm.

### Install

```bash
npm install
```

### Configure the source vault (optional for browsing)

Copy the example environment file and point it at your vault:

```bash
cp .env.example .env
# then set, e.g.:
# TVB_SOURCE_VAULT=/absolute/path/to/your/vault
```

`.env` is git-ignored. If `TVB_SOURCE_VAULT` is unset, the importer fails with a
clear message instead of guessing a location.

### Run

```bash
npm run dev        # Vite dev server with the live bridges mounted
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build with Vite preview
npm run serve      # standalone Node.js host (hardened, loopback by default)
```

On a clean checkout the `prebuild`/`predev`/`pretypecheck` hooks seed the
git-ignored snapshot `src/data/generated/opportunity-data.json` from the
committed demonstration fixture, so `npm run build` works with no vault.

### Import from the vault

```bash
npm run import:data   # read-only vault -> src/data/generated/opportunity-data.json
```

The importer opens the vault read-only, takes SHA-256 manifests before and after,
and writes only inside this repository. Generated data is git-ignored.

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Type-check and build to `dist/` |
| `npm run preview` | Preview the built app |
| `npm run serve` | Standalone Node.js host (`server/serve.ts`) |
| `npm run typecheck` | `tsc -b` |
| `npm run import:data` | Read-only vault import |
| `npm run ensure:snapshot` | Seed the snapshot from the fixture if missing |
| `npm run test:data` | Data-model / selector / import tests |
| `npm run test:automation` | Automation pipeline tests |
| `npm run test:live` | Live-source and bridge/host tests |
| `npm run test:vault` | Vault writer / bridge boundary tests |
| `npm run test:qa` | Playwright end-to-end suite (see note below) |

> The Playwright suite (`testDir: ./qa`) is **not included in this repository**.
> The `qa/` directory is kept local-only; a clone will not have those specs.

## Project structure

```
src/
  analytics/        dashboard aggregations
  app/              app shell, routes, navigation
  automation/       discovery pipeline: adapters, gates, normalize, classify,
                    dedup, orchestrator, review queue, proposal/write rules
  components/       UI components (discovery, review, navigation, tables, ui)
  data/             snapshot selectors + committed test fixtures
  import/           read-only vault -> JSON importer
  live-source/      same-origin bridges (TED, USAspending, Grants.gov, EU SEDIA)
                    and their live discovery stores
  pages/            route-level pages
  types/            record models + the authoritative type registry
  vault-bridge/     browser-side read/write bridge contract
  vault-writer/     guarded vault write path
server/             minimal production host (config, app, lifecycle, limits)
scripts/            build/bootstrap helpers
```

## Record types

The authoritative list lives in `src/types/registry.ts` (ID field/prefix,
collection key, route segment, labels, relationship fields). Every other map is
derived from it. Funding types include Opportunity, Match, Application, and the
supporting Company / Organization / Source records; procurement adds Notice,
Bid, and Contract.

## Live discovery sources

Each live source is reached only through a **same-origin bridge** (server-side
multipart/JSON request to a fixed official endpoint); the browser never talks to
the external API directly. Bridges report the source's real status and never mask
a failure as an empty success. Missing values stay `null`, and no
"open/eligible" verdict is inferred — an explicit, separately-tested gate decides
only what the source data supports.

## Safety & boundaries

- The production vault and `src/data/generated/` are never committed.
- The live bridges use no credentials and are read-only.
- The standalone host binds to loopback by default; a non-loopback bind requires
  the explicit `TVB_ALLOW_NON_LOOPBACK=1` opt-in and a fronting reverse proxy.
- Cross-origin requests are denied unless listed in `TVB_ALLOWED_ORIGINS`.
- Rate limiting, request-size limits, timeouts, and a concurrency cap protect
  the host (see below).

## Host environment variables

| Variable | Default | Meaning |
|---|---|---|
| `TVB_HOST` | `127.0.0.1` | Bind address (loopback only unless opted in) |
| `TVB_PORT` | `4174` | Bind port |
| `TVB_DIST_DIR` | `./dist` | Static build directory |
| `TVB_ALLOWED_ORIGINS` | *(empty)* | Comma-separated extra CORS origins |
| `TVB_RATE_LIMIT_WINDOW_MS` | `60000` | Rate-limit window |
| `TVB_RATE_LIMIT_MAX` | `30` | Max requests per window |
| `TVB_RATE_LIMIT_MAX_KEYS` | `5000` | Max tracked clients |
| `TVB_MAX_BODY_BYTES` | `65536` | Max request body |
| `TVB_REQUEST_TIMEOUT_MS` | `30000` | Per-request timeout |
| `TVB_MAX_CONCURRENT` | `4` | Max in-flight requests |
| `TVB_DRAIN_MS` | `5000` | Shutdown drain time |
| `TVB_ALLOW_NON_LOOPBACK` | *(unset)* | Set to `1` to allow a public bind |
| `TVB_SOURCE_VAULT` | *(unset)* | Absolute path to the source vault (import only) |

A present-but-invalid value fails startup with a clear configuration error;
protections are never silently disabled.

## Testing

Unit/integration tests run with the Node.js test runner:

```bash
npm run test:data
npm run test:automation
npm run test:live
npm run test:vault
npm run typecheck
```

Browser end-to-end tests use Playwright (`npm run test:qa`), but the `qa/`
directory is intentionally kept out of this repository. Run `npm run build`
before the Playwright suite; it serves `dist/` via `vite preview`.

## License

Private project. All rights reserved.
