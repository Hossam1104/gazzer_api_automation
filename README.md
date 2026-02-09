# Gazzer API Automation Framework

> Enterprise-grade API testing for the Client Addresses domain.
> Validates business rules, security (OWASP API Top 10), localization (AR/EN), and resilience.

---

## Overview

This framework is a **Playwright + TypeScript** automation suite that validates the Gazzer **Client Addresses API** across five dimensions:

1. **Functional correctness** — CRUD operations with contract validation
2. **Business rule enforcement** — Address limits, default protection, field constraints
3. **Security testing** — SQL injection, XSS, path traversal, command injection, NoSQL, LDAP, format string attacks
4. **Localization** — Arabic and English payload + response validation
5. **Resilience** — Rate limit handling with multi-user failover

The framework dynamically generates **200-250 unique test scenarios** per run, adapts to existing database state (non-destructive), and produces executive-grade HTML reports with a dashboard landing page.

---

## Business Rules Covered

| ID | Rule | Enforcement |
|:---|:-----|:------------|
| **BR-001** | Max 20 Addresses | Tests create until limit, then verify API rejects the 21st with 400/422. Precondition-checked: skips if seeding fails. |
| **BR-002** | Address Length (50 chars) | Validates field length constraints on create and update. API enforces on CREATE only. |
| **BR-003** | Default Protection | Attempts to delete a default address — API must reject. Default is never cleaned up. |
| **BR-004** | Single Default | After set-default, verifies exactly one address has `is_default: true`. |

---

## Test Coverage

| Category | Description | Approx. Count |
|:---------|:------------|:--------------|
| Happy Path | Valid CRUD across EN and AR | ~50 |
| Validation | Missing fields, invalid types, length overflow | ~20 |
| Edge & Boundary | Exactly 50 chars, zero-length, special characters | ~10 |
| Localization (EN/AR) | Arabic payload creation, error message validation | ~20 |
| Security (OWASP) | SQLi (8), XSS (10), Path Traversal (4), CMD Injection (4), NoSQL (3), LDAP (3), Format String (3), Edge Cases (4) | ~39 |
| State & Idempotency | Set-default verification, duplicate detection, create-then-verify | ~20 |
| Rate Limit Resilience | Multi-user failover under 429 throttling | ~10 |
| **Total** | Dynamically generated per run | **200-250** |

---

## Project Structure

```
gazzer_api_automation/
├── src/
│   ├── api/
│   │   ├── controllers/           # API request controllers (Auth, Addresses)
│   │   ├── specs/                 # Test specifications (6 spec files)
│   │   ├── validators/            # Zod schemas + business rule assertions
│   │   └── data/                  # Test payload factories (valid, invalid, arabic, security)
│   ├── utils/
│   │   ├── reportExporter.ts      # JSON/HTML report generation pipeline
│   │   ├── resilientClient.ts     # Rate-limit failover wrapper
│   │   ├── multiUserManager.ts    # Two-user auth pool with rotation
│   │   ├── stateTracker.ts        # Non-destructive address state management
│   │   ├── responseHelper.ts      # BOM-safe JSON parsing
│   │   ├── capacityHelper.ts      # Address slot management + cleanup
│   │   ├── executionTracker.ts    # Per-test metadata persistence
│   │   ├── payloadCapture.ts      # Request/response capture for reports
│   │   ├── apiClient.ts           # HTTP header builder + logging
│   │   ├── localization.ts        # Bilingual test helpers (EN/AR)
│   │   ├── provinceDataLoader.ts  # Province/zone reference data
│   │   └── testSetup.ts           # Shared auth + state bootstrap
│   ├── config/
│   │   ├── global.config.ts       # Config loader (global_config.json + .env)
│   │   ├── env.ts                 # Environment variable parsing
│   │   └── globalSetup.ts         # Playwright global setup (payload cleanup)
│   └── scripts/
│       └── generate_report.ts     # Report generation entry point
├── reports/                       # Generated reports (JSON + HTML)
│   ├── manifest.json              # Report registry for dashboard discovery
│   ├── ClientAddresses_execution.json
│   └── ClientAddresses_report.html
├── assets/
│   ├── report.html                # HTML report template (source of truth)
│   └── customer_app_collection/   # Postman API reference collections
├── index.html                     # Dashboard landing page
├── script.js                      # Dashboard controller (report discovery + metrics)
├── styles.css                     # Dashboard styles (responsive, dark/light theme)
├── config.js                      # Dashboard UI configuration
├── global_config.json             # Execution config (auth, delays, test bounds)
├── playwright.config.ts           # Playwright runner configuration
└── serve-dashboard.bat            # One-click dashboard server (Windows)
```

---

## How to Run

### Prerequisites
- **Node.js** v18+
- **npm** v9+

### Install
```bash
npm install
```

### Run Tests
```bash
npm test
```
Executes the full suite (200-250 dynamic + static tests). Takes ~8-10 minutes.

### Generate Report
```bash
npm run report
```
Produces `reports/ClientAddresses_execution.json` and `reports/ClientAddresses_report.html`.

### CI / One-Shot
```bash
npm run test:ci
```
Runs tests and immediately generates the report.

### Open Dashboard
```bash
# Option A: Use the batch file (recommended, avoids CORS issues)
serve-dashboard.bat

# Option B: Use npx directly
npx http-server . -p 8080 -o

# Option C: Open index.html directly (limited by browser CORS policy)
```

---

## Reporting Model

```
Playwright JSON  -->  ReportExporter  -->  Execution JSON  -->  HTML Report
                                      -->  Dashboard JS     -->  Dashboard
```

- **JSON** (`reports/ClientAddresses_execution.json`): Source of truth with full metrics, test cases, bugs, and integrity data
- **HTML** (`reports/ClientAddresses_report.html`): Standalone executive report with tabs for Summary, Security (OWASP), Infrastructure, and HTTP Payloads
- **Dashboard** (`index.html`): Landing page that reads from `reports/manifest.json` and displays KPI cards, category filtering, and one-click report access

### Report Tabs

| Tab | Content |
|:----|:--------|
| Executive | Pass rates, release readiness, bug breakdown by severity, category health |
| Security (OWASP) | OWASP API Top 10 mapping, coverage analysis per attack category |
| Infrastructure | Rate limit events (total/recovered/exhausted), response time metrics |
| HTTP Payloads | Full request/response pairs per test, multi-language payload view |

---

## Configuration

### `.env`
```env
BASE_URL=https://client-backend.gazzertest.cloud
AUTH_EMAIL=<primary_user_login>
AUTH_PASSWORD=<primary_user_password>
ENVIRONMENT=TEST
REQUEST_DELAY_MS=500
MAX_RETRIES=3
API_VERSION=v1
```

### `global_config.json`
```jsonc
{
  "api": { "base_url": "..." },
  "app_bases": {
    "customer": {
      "authentication": {
        "user_one": { "login": "...", "password": "..." },
        "user_two": { "login": "...", "password": "..." },
        "login_endpoint": "/api/clients/auth/login"
      }
    }
  },
  "execution": {
    "minimum_test_cases": 200,
    "max_test_cases": 250,
    "request_delay": 1.0,
    "cleanup_enabled": true,
    "cleanup_mode": "partial"
  }
}
```

### `playwright.config.ts` Key Settings
- **timeout**: 120s (accounts for rate-limit retries + cleanup)
- **retries**: 0 (retries handled at controller level, not runner level)
- **workers**: 1 (sequential to prevent auth storms)
- **trace**: retain-on-failure

---

## Troubleshooting

| Issue | Cause | Solution |
|:------|:------|:---------|
| Tests fail with 429 | Rate limit exhausted on both users | Increase `request_delay` in `global_config.json` |
| 401 Unauthorized | Invalid credentials or expired token | Check `user_one`/`user_two` in `global_config.json` |
| Empty payloads in report | Reporter can't find capture files | Ensure `globalSetup.ts` runs (check `playwright.config.ts`) |
| Dashboard CORS error | Opening `index.html` via `file://` | Use `serve-dashboard.bat` or `npx http-server . -p 8080` |
| Report shows wrong count | Stale `execution-report.json` | Run `npm test` then `npm run report` |
| "Setup Error" in report | Test data validation failed | Check `diagnostic_notes` in report JSON for field errors |

---

## API Contract Notes

- Auth token field: `access_token` (not `token`)
- Response format: `{ status: "success" | "error" }` (not `{ success: true }`)
- Validation errors return HTTP `422` (not `400`)
- Create/Update responses return empty `data: []` — must fetch to get ID
- Set-default endpoint expects `address_id` (not `id`)
- API has duplicate location detection — coordinates must vary by ~0.01+ degrees
- API paginates by default (~10 per page) — use `per_page=100` for full listings

---

> Generated for Gazzer QA Team
