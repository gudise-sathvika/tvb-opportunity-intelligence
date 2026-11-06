# TVB Opportunity Intelligence

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19.x-61dafb.svg)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-6.x-646cff.svg)](https://vitejs.dev/)
[![Tests](https://img.shields.io/badge/Tests-427%2B%20Passing-success.svg)](https://nodejs.org/)

An enterprise-grade, rules-driven **Opportunity Intelligence & Discovery Platform** engineered for venture builders, investment teams, and portfolio companies.

TVB Opportunity Intelligence continuously monitors, indexes, and evaluates public funding calls, innovation grants, and government procurement tenders across the United States, European Union, and India — automatically matching them against imported target company profiles with transparent, explainable suitability scoring.

---

## 🚀 Key Capabilities & Modules

### 1. Multi-Source Global & Indian Discovery Engine
Aggregates live opportunities through hardened, same-origin server bridges without exposing browser clients to external rate limits or CORS restrictions:

* **United States & International Funding:**
  * **Grants.gov:** US Federal innovation grants (SBIR/STTR, NIH, NSF, DoD, DoE).
  * **USAspending:** Historical federal award intelligence and obligations context.
  * **World Bank:** Multilateral development bank procurement and global advisory RFPs.
* **European Union Ecosystem:**
  * **EU Funding & Tenders (SEDIA):** Horizon Europe, Digital Europe, and European Innovation Council (EIC) cascade calls.
  * **TED (Tenders Electronic Daily):** Official public procurement notices across all EU member states.
* **India Innovation Schemes & Public Procurement:**
  * **GeM (Government e-Marketplace):** Central/State public procurement contracts for Cloud Migration, DevOps, Custom Web/Mobile Apps, AI/OCR, and Cybersecurity. Includes direct tender document PDF links.
  * **CPPP (Central Public Procurement Portal):** Live active e-Procurement notices across ministries and PSUs.
  * **MeitY & Central Grants:** SAMRIDH Accelerator, TIDE 2.0 (ICT grants), GENESIS (Tier-2/3 scale-up), Bhashini AI Mission, Chips to Startup (C2S), and Cyber Swachhta Kendra (CSK).
  * **Defence & Space:** iDEX (Defence India Startup Challenge DISC & SPARK grants up to ₹10 Cr), IN-SPACe seed fund.
  * **Biotech & HealthTech:** BIRAC (Biotechnology Industry Research Assistance Council) active Call for Proposals.
  * **State Innovation Missions:** Karnataka ELEVATE, Tamil Nadu TANSEED, Kerala Startup Mission (KSUM), Gujarat IT/ITeS, Odisha, and Telangana emerging technologies.

---

### 2. Target Company Ingestion & Web Intelligence (Firecrawl)
* **CSV Bulk Importer:** Upload target company spreadsheets with auto-detection of columns (`company name`, `company HQ location`, `company sector`, `company URL`, `tags`).
* **Persistent Local Storage:** Imported companies are securely persisted in browser storage (`tvb:target-companies:imported-set`) with full table preview and single-click reset.
* **Firecrawl Web Intelligence Engine:**
  * **Automatic Domain Resolution:** Discovers official company domains if the website URL is omitted or malformed.
  * **Deep Capability Extraction:** Scrapes and parses tech stack, specialized capabilities, AI/ML focus, and target market segments (enterprise vs SMB).
  * **Dual-Branch Jurisdiction Matching (India + US):** Automatically detects companies with multi-region operations (e.g., Bangalore HQ + US Delaware subsidiary). Enables simultaneous eligibility for Indian domestic tenders/grants and US/International federal RFPs.
  * **Intelligent Local Caching:** Caches enrichment results locally (`tvb:company-enrichment-cache`) to prevent redundant web scraping.

---

### 3. Explainable Suitability Scoring & Match Matrix
Replaces black-box AI scores with a deterministic, explainable scoring engine:

* **Topical Alignment (70%):** Sector, technology stack, and keyword semantic matching.
* **Geographic & Legal Eligibility (20%):** Enforces statutory nationality requirements (e.g., US SBIR domestic business requirements vs Indian MSME/DPIIT criteria).
* **Entity Type Gate (10%):** Differentiates commercial Pvt Ltd / LLC startups from non-profit universities or research laboratories.
* **Categorized Match Status:**
  * 🟢 **Relevant (≥ 70%):** Strong topical fit and satisfied geographic/entity criteria.
  * 🟡 **Potentially Relevant (40–69%):** Adjacent technical capabilities or provisional location alignment.
  * 🔴 **Not Relevant (< 40%):** Topical divergence or statutory eligibility mismatch.
  * ⚪ **Unassessed (—):** Missing data remains visibly unassessed—never fabricated or defaulted to 0%.
* **Interactive Matrix View:** Dynamic multi-company × opportunity heatmap with real-time scope switching, sorting (by Best Match, Deadline, Title), and keyword search.

---

### 4. Direct Document & Portal Routing
Eliminates 404 errors and broken redirects:
* **Verified GeM Tender PDFs:** Links directly download or open authentic tender specification PDFs (`https://bidplus.gem.gov.in/showbidDocument/${id}`) verified for byte size and valid `%PDF-1.4` signatures.
* **Direct CPPP SPA Routing:** Routes to the active tenders portal (`https://eprocure.gov.in/cppp/#/activeTenders`).
* **Verified National Portals:** Routes to official scheme pages (MyScheme, DST Call for Proposals, BIRAC CFP) with trusted commercial SSL certificates.

---

### 5. Standardized Qualified Leads CSV Export
Exports qualified opportunities directly formatted for venture pipelines:
* **Strict 21-Column Schema:** Adheres to the master venture portfolio specification:
  1. `Opportunity ID`
  2. `Type` (Grant / RFP)
  3. `Title`
  4. `Issuer / Funder`
  5. `Issuer type` (Government / Public Body)
  6. `Relevant TVB related Company`
  7. `Description`
  8. `Category / Sector`
  9. `Geography` (India, United States, European Union, Global)
  10. `Funding amount min (if any)`
  11. `Funding amount max (if any)`
  12. `Currency` (INR, USD, EUR)
  13. `Posted date`
  14. `Deadline`
  15. `Link` (Direct official specification URL)
  16. `Source` (GeM, CPPP, Grants.gov, TED, MeitY, iDEX, etc.)
  17. `Fit score (1-5)` (Normalized 1 to 5 scale)
  18. `Owner` (Default: `Sathvika`)
  19. `Date added`
  20. `Last updated`
  21. `Notes` (Meaningful justification with specific capability alignment and operating branch routing)
* **Batch Downloader:** Allows exporting all leads or downloading targeted batches (e.g., *Leads 1–10*, *Leads 11–20*).

---

## 🛠️ Tech Stack

* **Frontend Framework:** React 19 with React Router 7.
* **Build System:** Vite 6 with TypeScript (`tsc -b`).
* **Styling:** Custom accessible design system with CSS custom properties and full Dark Mode support.
* **Backend / Host:** Hardened Node.js production host (`server/serve.ts`) mounting loopback-guarded live bridge proxies.
* **Testing:** Native Node.js test runner with `tsx` (427+ unit and integration tests passing).

---

## 📁 Repository Structure

```
tvb-frontend/
├── src/
│   ├── analytics/               # Dashboard metrics and pipeline aggregation
│   ├── app/                     # Route definitions, layout shell, dark mode
│   ├── automation/              # Discovery pipelines, adapters, deduplication & review queues
│   ├── components/
│   │   ├── discovery/           # Live search cards, scope selectors, and candidate views
│   │   ├── match-review/        # Review queue handoff for funding matches
│   │   ├── procurement-match-review/ # Review queue handoff for tender notices
│   │   ├── target-companies/    # CSV preview, Match Matrix, Leads download menu
│   │   └── tables/              # Data tables with pagination and sorting
│   ├── data/                    # Snapshot selectors and committed test fixtures
│   ├── live-source/             # Same-origin bridges:
│   │   ├── enrichment-bridge/   # Firecrawl web scraping, domain resolution & dual presence
│   │   ├── gem-bridge/          # GeM tender specifications & CPPP notices
│   │   ├── india-grants-bridge/ # MeitY, iDEX, DST, BIRAC & state schemes
│   │   ├── grantsgov-bridge/    # US federal grants bridge
│   │   ├── ted-bridge/          # European TED procurement bridge
│   │   ├── eu-sedia-bridge/     # EU Horizon & cascade funding bridge
│   │   └── worldbank-bridge/    # World Bank multilateral notices bridge
│   ├── target-companies/        # CSV parser, enrichment store, scoring engine, CSV exporter
│   └── types/                   # Authoritative TypeScript types and registry
├── server/                      # Hardened Node.js server with rate-limiting and reverse proxy guards
├── scripts/                     # Snapshot bootstrap and build verifiers
└── public/                      # Static assets and manifest
```

---

## 💻 Getting Started

### Prerequisites
* **Node.js:** v20.x or higher
* **npm:** v10.x or higher

### Installation
```bash
git clone https://github.com/gudise-sathvika/tvb-opportunity-intelligence.git
cd tvb-opportunity-intelligence/tvb-frontend
npm install
```

### Development Server
Starts the Vite development server with all live opportunity bridges mounted:
```bash
npm run dev
```
Open your browser at `http://localhost:5173`.

### Production Build & Typecheck
Verifies TypeScript project references and builds the production bundle into `dist/`:
```bash
npm run build
```

### Preview Production Build
```bash
npm run preview
```

### Standalone Node.js Host
Runs the standalone production server (`server/serve.ts`):
```bash
npm run serve
```

---

## 🧪 Testing

The codebase includes an extensive suite of **427+ unit and integration tests**:

```bash
# Run data model, CSV parser, and matching tests
npm run test:data

# Run Firecrawl enrichment bridge tests
npx tsx --test src/live-source/enrichment-bridge/handler.test.ts

# Run qualified leads CSV export tests
npx tsx --test src/target-companies/export-leads-csv.test.ts

# Full TypeScript check
npm run typecheck
```

---

## 🌐 Deployment (Vercel & Render)

### Vercel (Frontend SPA)
1. Import the repository on Vercel.
2. Set **Root Directory** to `tvb-frontend`.
3. Framework Preset: **Vite**.
4. Build Command: `npm run build`.
5. Output Directory: `dist`.

### Render (Full-Stack Host with Bridges)
1. Create a **Web Service** on Render connected to this repository.
2. Set **Root Directory** to `tvb-frontend`.
3. Environment: **Node**.
4. Build Command: `npm install && npm run build`.
5. Start Command: `npm run serve`.
6. Environment Variables:
   * `TVB_HOST=0.0.0.0`
   * `TVB_PORT=10000`
   * `TVB_ALLOW_NON_LOOPBACK=1`

---

## 📄 License & Maintainer

Maintained for **The Venture Build (TVB)**.
Lead Contributor & Platform Engineer: **Sathvika Gudise** (`Owner: Sathvika`).
All rights reserved.
