# Gazzer API Automation Framework: Client Addresses

> [!IMPORTANT]
> **Domain**: Client Addresses API
> **Focus**: Business Rule Enforcement & Non-Destructive Automation
> **Version**: 1.1
> **Last Updated**: 2026-02-06

## 1. 🎯 Mission Objective
Build a robust, business-rule-aware API automation suite for the Client Addresses domain that:
- Validates functional correctness of all API endpoints.
- Enforces business rules at the API contract level.
- Preserves real database state (**NO hard deletes**, **NO environment resets**).
- Detects authorization, validation, and quota violations.
- Produces machine-readable execution evidence (JSON).
- Renders executive-friendly HTML reports.
- Runs safely in CI/CD pipelines without environment destruction.

### Non-Negotiable Assumptions
- Addresses are created normally during test execution.
- Test data accumulates intentionally in the database.
- Cleanup is logical (soft deletes/state management), not physical.
  > [!NOTE]
  > Logical cleanup MUST NOT assume backend soft-delete capability unless explicitly supported by the API contract. If soft-delete is unavailable, cleanup MUST be skipped entirely.
- Tests adapt to existing database state, not vice-versa.

---

## 2. 🧱 Architecture Overview
**Pattern**: API Page Object Model (Controller-based)

| Layer | Responsibility | Technology |
| :--- | :--- | :--- |
| **Controller** | HTTP calls only, no assertions | Playwright APIRequestContext |
| **Spec** | Business intent + assertions | Playwright Test + Jest-style |
| **Data** | Payloads & edge cases | TypeScript interfaces/objects |
| **Validators** | Schema & business rules | Zod + custom validators |
| **Config** | Auth, URLs, environment | Environment variables + config files |
| **Utils** | State tracking, logging, reporting | Custom TypeScript modules |

---

## 3. 📁 Project Structure
```text
src/
├── api/
│   ├── controllers/
│   │   ├── AuthController.ts           # Authentication
│   │   └── ClientAddressesController.ts # Address CRUD operations
│   ├── data/
│   │   ├── address.valid.payload.ts     # Valid templates
│   │   ├── address.invalid.payload.ts   # Edge cases
│   │   ├── address.boundary.payload.ts  # Boundary values
│   │   └── address.business-rules.ts    # Business rule data
│   ├── validators/
│   │   ├── address.schema.validator.ts  # Zod schemas
│   │   └── address.business.validator.ts# Business rules
│   └── specs/
│       ├── addresses.list.spec.ts       # GET /api/clients/addresses
│       ├── addresses.create.spec.ts     # POST /api/clients/addresses
│       ├── ...                          # Other specs
├── config/
│   ├── global.config.ts                 # Global settings
│   └── env.ts                           # Environment configs
├── utils/
│   ├── apiClient.ts                     # Base client (auth injection)
│   ├── stateTracker.ts                  # Non-destructive state mgmt
│   └── reportExporter.ts                # JSON/HTML reporting
└── test-results/                        # Generated artifacts
```

---

## 4. 🔐 Authentication & Configuration

### Authentication Flow
```http
POST /api/clients/auth/login
Content-Type: application/json

{
  "email": "${AUTH_EMAIL}",
  "password": "${AUTH_PASSWORD}"
}
```
**Response**: `{ "success": true, "data": { "token": "...", "expires_in": 3600 } }`

### Configuration Requirements
| Setting | Source | Required | Default |
| :--- | :--- | :--- | :--- |
| `BASE_URL` | ENV | Yes | - |
| `API_VERSION` | ENV | No | v1 |
| `AUTH_EMAIL` | ENV | Yes | - |
| `AUTH_PASSWORD` | ENV | Yes | - |
| `REQUEST_DELAY` | ENV | No | 100ms |
| `MAX_RETRIES` | ENV | No | 3 |

---

## 5. 📌 Core Business Rules

| Rule | Definition | Expected Behavior |
| :--- | :--- | :--- |
| **BR-001** | Max 20 Addresses | API rejects 21st address with 400/422. |
| **BR-002** | Field Constraints | `address` field max 50 chars; API enforces backend limits. |
| **BR-003** | Default Protection | Cannot delete address where `is_default: true`. |
| **BR-004** | Single Default | Only one address per user can be default at a time. |

---

## 6. 🧪 Test Scenario Matrix

### 6.0.1 Test ID Convention
Format:
```
ADDR-<ACTION>-<SEQUENCE>
```

Examples:
- `ADDR-LIST-001`
- `ADDR-CREATE-004`
- `ADDR-DELETE-002`
- `ADDR-UPDATE-003`

Test IDs MUST be:
- Unique across the test suite
- Stable (never change once assigned)
- Used in all reporting and logging

> [!NOTE]
> Test IDs enable traceability, bug linking, and CI analytics.

### 6.1 GET – List Addresses
**Endpoint**: `GET /api/clients/addresses`

- **✅ Happy Path (200)**: Assert `success: true`, `data` is array, elements have `id` (number) and `is_default` (boolean/int), valid pagination.
- **🚫 Unauthorized (401)**: Assert failure message includes "auth" or "unauthorized".

#### 6.1.1 Authorization Scenarios
- **Missing token**: Returns 401
- **Invalid token**: Returns 401
- **Expired token**: Returns 401
- **Token for wrong user context**: Returns 403 (if applicable)

> [!NOTE]
> If token scope/expiry testing is not applicable for this API, mark as out of scope.

### 6.2 POST – Create Address
**Endpoint**: `POST /api/clients/addresses`

- **✅ Happy Path (200)**: Precondition `< 20 addresses`. Assert `id` exists, `address.length <= 50`.
- **❌ Limit Reached (400/422)**: Precondition `20 addresses`. Assert message includes "limit" or "maximum".
- **❌ Validation Error (400)**: Address length > 50. Assert specific field error.

#### 6.2.1 Address Limit Test Strategy
Limit-related tests MUST:
- Read current address count via GET
- Dynamically decide:
  - Create addresses until count == 20 (if below)
  - Skip creation if count > 20
- NEVER delete pre-existing addresses

> [!IMPORTANT]
> This preserves the non-destructive contract.

### 6.3 POST – Update Address
**Endpoint**: `POST /api/clients/addresses/update/{id}`

- **✅ Happy Path (200)**: Assert `data.id` matches, `updated_at` is valid date.
- **❌ Validation Error (400)**: Coordinate format, missing fields, or non-existent ID.

### 6.4 DELETE – Delete Address
**Endpoint**: `DELETE /api/clients/addresses/{id}`

- **❌ Default Protection (400/403)**: Attempt deleting default. Assert "default" and "delete" in message.
- **✅ Happy Path (200/204)**: Non-default address. Assert `success: true`.

---

## 7. 🧠 Validators Implementation

### 7.1 Schema Validator (Zod)
```typescript
const AddressSchema = z.object({
  id: z.number().positive(),
  address: z.string().max(50),
  is_default: z.union([z.boolean(), z.literal(0), z.literal(1)]),
  created_at: z.string().min(10)
});
```

### 7.2 Business Validator
- `validateAddressLimit`: Ensures count ≤ 20.
- `validateDefaultAddressDeletion`: Blocks deletion if `is_default` is true.
- `validateSingleDefaultAddress`: Ensures `defaultCount === 1` in the list.

### 7.3 Error Response Contract (Minimum)
All error responses MUST include:
- `success: false`
- `message: string`
- Either:
  - `errors: object`
  - OR `error_code: string`

Tests MUST fail if:
- Error structure changes unexpectedly
- Required keys are missing

### 7.4 Contract Drift Detection
If API responses include unexpected fields:
- Tests MUST log the new fields
- Tests MUST NOT fail solely due to new fields
- Drift MUST be surfaced in reports

> [!NOTE]
> This keeps automation from blocking backend evolution while still alerting teams to potential contract changes.

---

## 8. 🧾 State Tracking (Non-Destructive)
`StateTracker` maintains current state without harming pre-existing data.

- **Capture**: Fetch initial address count and default ID before tests.
- **Track**: Log IDs of addresses created *during* the test session.
- **Cleanup**: Perform "soft" logical cleanup only on tracked IDs (excluding defaults).

---

## 9. ⚙️ Controller Rules
- **MUST NOT**: Assert, handle business logic, or manage auth state directly.
- **MUST**: Return raw responses, support all methods, handle headers, and implement retry logic for 5xx/Network errors.

### 9.1 Retry Logic Guardrails
Retry attempts MUST:
- Be capped by MAX_RETRIES (configurable, default 3)
- Log retry count and reason
- Never mask final failures
- Include jitter to prevent thundering herd

Retries MUST NOT be applied to:
- 4xx responses (client errors)
- Business rule violations

> [!IMPORTANT]
> Retries can silently hide instability if not properly guarded.

---

## 10. 📊 Reporting & 11. 🖥️ HTML Report
**Flow**: `Playwright` → `execution-report.json` → `api-test-report.html`

### Report Requirements:
- **Executive Dashboard**: Pass/Fail rates, Business Rule compliance.
- **Interactivity**: Filterable/Sortable tables, Expandable test details.
- **Evidence**: Full Request/Response pairs for failed cases.
- **Portability**: Self-contained HTML (zero external JS/CSS dependencies).

---

## 12. 📈 Non-Functional Requirements
- **Determinism**: 100% adaptation to existing DB state.
- **Safety**: Zero hard deletes.
- **Observability**: Full evidence for every failure.
- **Parallel Safety**: Parallel-safe execution with unique data.

### 12.1 Test Data Uniqueness
All created addresses MUST include a unique suffix derived from:
- Worker index
- Timestamp
- UUID

This ensures:
- No collisions between parallel workers
- Predictable address counts
- Reliable limit testing

---

## 13. 🛡️ Environment Safety Guard

### 13.1 Environment Safety Check
Test execution MUST abort if:
- `BASE_URL` matches known production domains
- `ENVIRONMENT` flag is missing or set to unknown value
- Required authentication credentials are not configured

```typescript
const PROD_DOMAINS = ['api.production.com', 'api.gazzar.com'];
const isProduction = PROD_DOMAINS.some(d => BASE_URL.includes(d));

if (isProduction && ENVIRONMENT !== 'CI') {
  throw new Error('Refusing to run destructive tests on production');
}
```

> [!WARNING]
> This guardrail prevents accidental production damage and protects teams from costly mistakes.

---

## 14. ⏱️ Timeout & Abort Strategy

### 14.1 Request Timeouts
- Each request MUST have a hard timeout (configurable, default 30s)
- Timeouts apply to all HTTP methods

### 14.2 Retry Exhaustion Behavior
If retries are exhausted:
- Test MUST fail fast
- Failure reason MUST be logged clearly
- Include retry count and last error in output

### 14.3 Global Execution Abort
Test execution MUST abort immediately if:
- Authentication token cannot be acquired
- Base connectivity to BASE_URL fails
- More than 50% of requests timeout consecutively

---

## 15. 🚀 Exit Criteria
- [ ] All 5 endpoints automated.
- [ ] 100% Business Rule coverage.
- [ ] JSON & HTML reports generated with evidence.
- [ ] Zero false positives and < 5 min execution time.

---

## 16. 🛡️ Risk Mitigation
- **DB Contamination**: Mitigated by `StateTracker`.
- **Auth Expiry**: Mitigated by token refresh/re-auth.
- **Rate Limits**: Mitigated by `REQUEST_DELAY`.
- **Parallel Interference**: Mitigated by unique data sets.

---

## 17. Implementation Phases (Original Plan)
1. **Foundation**: Auth, Client, Reporting structure.
2. **Controllers**: CRUD operations + Logging + Retry.
3. **Validators**: Zod schemas + Business rules.
4. **Specs**: All endpoint scenarios (Happy/Fail).
5. **State & Reports**: `StateTracker` + JSON/HTML generation.
6. **CI/CD**: Pipeline setup + artifacts.

---

## 18. Implementation History (What Was Actually Built)

### Phase 1 — Foundation (Feb 6-7, 2026)
- AuthController with primary user login
- ClientAddressesController with CRUD operations
- 5 static spec files (list, create, update, delete, default)
- StateTracker for non-destructive address lifecycle management
- Basic ReportExporter generating HTML from Playwright JSON
- Environment config via `.env` + `global_config.json`

### Phase 2 — Critical Repairs (Feb 7)
- **Auth propagation fix**: API uses `access_token` (not `token`); updated all specs
- **BOM handling**: Added ResponseHelper.safeJson() to strip UTF-8 BOM before parsing
- **StateTracker hardening**: Fail-fast on non-200 responses, handle `status: "success"` format
- **Report rebuild**: Complete rewrite of ReportExporter (was showing -10 passed, 0 total)
- **Payload corrections**: Added required fields (building, floor, apartment, lat, long)
- **API contract discovery**: Documented 422 vs 400, empty data arrays, pagination defaults

### Phase 3 — Scale & Corrections (Feb 8)
- **Dynamic test generation**: `addresses.dynamic.spec.ts` generating 200+ test cases
- **BR-001 precondition logic**: Seed loop with consecutive failure tracking + PRECONDITION_SKIP
- **Report generation bug**: Fixed reportExporter to loop ALL spec.tests (was only reading first)
- **Payload persistence**: Moved cleanDiskPayloads() to globalSetup.ts (single cleanup at start)
- **Arabic test visibility**: Added language badges and filter dropdown to HTML report
- **Bug classification**: Distinguished API bugs from env constraints (SKIPPED_ENV_CONSTRAINT)
- **ADDR-DEFAULT-001 timing**: Added 300ms delay for API eventual consistency

### Phase 4 — Security & Resilience (Feb 8-9)
- **Security payloads**: SQL injection (8), XSS (10), path traversal (4), command injection (4), NoSQL (3), LDAP (3), format string (3), edge cases (4) — 39 attack vectors
- **OWASP mapping**: Test IDs mapped to OWASP API Top 10 categories (API1-API8)
- **Multi-user failover**: Two-user auth pool with automatic rotation on 429
- **ResilientClientAddresses**: Transparent failover wrapper around controller
- **Rate limit classification**: Changed from ENVIRONMENT_NOISE to INFRA_FAILURE
- **Human-readable errors**: humanizeError() method with 8+ specific patterns replacing raw Playwright assertions
- **Request delay tuning**: Increased from 0.5s to 1.0s to reduce 429 frequency

### Phase 5 — Dashboard & Reporting (Feb 9)
- **Executive dashboard**: `index.html` + `script.js` + `styles.css` (vanilla JS, no frameworks)
- **Report manifest**: `reports/manifest.json` for automatic API report discovery
- **Strict metric mapping**: Dashboard reads JSON with zero inference, shows N/A for missing data
- **KPI cards**: Aggregated Total APIs, Total Tests, Success Rate, Issues Found
- **Per-API cards**: Metrics, severity breakdown, OWASP coverage, language badges
- **Theme toggle**: Light/Dark mode with localStorage persistence
- **Category filtering**: Admin, Customer, Vendor, Delivery categories
- **CORS handling**: file:// protocol support + serve-dashboard.bat for http-server

### Phase 6 — Cleanup & Governance (Feb 9)
- Deleted 5 useless files (artifacts + historical fix logs)
- Removed 4 dead exports from payload files
- Updated .gitignore with .vs/ exclusion
- Rewrote README.md as authoritative source
- Consolidated markdown documentation
- All TypeScript files verified to have professional JSDoc headers

---

## 19. Known Limitations

- **Rate limit sensitivity**: API throttles aggressively; even with 1.0s delay and two users, some tests may hit 429 during high-volume runs
- **Eventual consistency**: Set-default API returns 200 before persistence completes; tests use 300ms delay as workaround
- **No soft-delete support**: API does not support soft-delete; cleanup is logical (track created IDs, delete non-defaults)
- **Single API coverage**: Currently only covers Client Addresses; other APIs (Restaurants, Cart, Orders) not yet automated
- **Sequential execution only**: Workers locked to 1 to prevent auth storms; parallelization requires per-worker auth pools

---

## 20. Future Enhancements

- Expand API coverage beyond Client Addresses (Restaurants, Cart, Orders, Payments)
- CI/CD pipeline refinement with GitHub Actions artifact management
- Performance benchmarks (response time tracking, P95/P99 metrics)
- Contract drift detection (alert on unexpected API response fields)
- Parallel execution with per-worker auth pool isolation
- Visual regression testing for the HTML report template