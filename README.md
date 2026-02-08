# 🚀 Gazzer API Automation Framework

> **Enterprise-grade API Testing Solution for Client Addresses**
>
> Automated validation of Business Rules, Security (OWASP), Localization (Ar/En), and Resilience for the Gazzer Platform.

---

## 📋 Overview

This framework is a robust, **Playwright + TypeScript** automation solution designed to validate the critical **Client Addresses API**. It goes beyond simple functional testing by enforcing business logic, testing security boundaries, and verifying system resilience under load.

### 🌟 Key Features

-   **🛡️ Business Rule Enforcement**: Validates core rules like *Max 20 Addresses* (BR-001) and *Single Default Address* (BR-004).
-   **🌍 Multi-Language Support**: Tests payloads in both **English** and **Arabic**, ensuring correct error localization.
-   **🔄 Resilience & Rate Limiting**: Intelligent retry logic with exponential backoff and **User Rotation** (User A -> User B) to handle 429 Rate Limits.
-   **🔒 Security & OWASP**: Automated checks for OWASP Top 10 vulnerabilities (BOLA, Broken Auth, Injection).
-   **📊 Executive Reporting**: Generates rich **HTML Artifacts** with:
    -   **Executive Summary**: Compliance & Health Health.
    -   **Security Tab**: OWASP mapping coverage.
    -   **Infrastructure Tab**: Rate limit & performance metrics.
    -   **HTTP Payloads**: Full request/response capture (including multi-step sequences).
-   **🏭 Dynamic Test Generation**: Automatically generates 200-250 unique test scenarios per run.

---

## 🛠️ Setup & Configuration

### Prerequisites
-   **Node.js**: v18+
-   **npm**: v9+

### Installation
```bash
npm install
```

### Configuration
1.  **Environment Variables**: Create a `.env` file (see `.env.example` if available) with:
    ```env
    BASE_URL=https://client-backend.gazzertest.cloud
    # Primary (Seed) User
    AUTH_EMAIL=<USER_1_LOGIN>
    AUTH_PASSWORD=<USER_1_PASSWORD>
    ```

2.  **Global Config** (`global_config.json`): Controls execution behavior and multi-user credentials.
    ```jsonc
    {
      "app_bases": {
        "customer": {
          "authentication": {
            // User Rotation Pool
            "user_one": { "login": "...", "password": "..." },
            "user_two": { "login": "...", "password": "..." }
          }
        }
      },
      "execution": {
        "minimum_test_cases": 200, // Min tests to generate
        "max_test_cases": 250,     // Max tests cap
        "request_delay": 0.5,      // Delay between reqs (seconds)
        "cleanup_enabled": true    // Auto-delete created data
      }
    }
    ```

---

## ▶️ Usage

### Run Tests
Execute the full suite (Dynamic + Static tests):
```bash
npm test
```

### Generate Report
Process the raw results into the HTML dashboard:
```bash
npm run report
```
> **Output**: `reports/ClientAddresses_report.html`

### CI / One-Shot
Run tests and immediately generate the report (ideal for CI pipelines):
```bash
npm run test:ci
```

---

## 📊 Understanding the Report

The generated **HTML Report** (`reports/ClientAddresses_report.html`) is the primary artifact. It contains three main views:

### 1. Executive Tab
-   **High-Level Summary**: Pass rates, total execution time, and release readiness.
-   **Bug Breakdown**: categorization of failures by type (Security, Localization, Business Rules).
-   **Category Health**: Visual progress bars for each test category.

### 2. Security Tab (OWASP)
-   **OWASP Top 10 Mapping**: Maps executed tests to specific OWASP API categories (e.g., *API1:2023 Broken Object Level Authorization*).
-   **Coverage Analysis**: Shows which security risks have been tested and their status.

### 3. Infrastructure Tab
-   **Rate Limit Analysis**: Tracks `429 Too Many Requests` events and the success rate of the **User Rotation** recovery mechanism.
-   **Performance**: Response time metrics (Avg, P95, Max) and identification of slow endpoints.

### 🔎 HTTP Payloads
Click on any test case to expand details. You will see a **Multi-Language Payload View** showing the full sequence of requests (e.g., *English Request* -> *Arabic Request*) to verify localization consistency.

---

## 🏗️ Project Structure

```text
src/
├── api/
│   ├── controllers/       # API interaction logic (Requests, Retries)
│   ├── specs/             # Test definitions (Dynamic & Static)
│   ├── validators/        # Zod schemas & Business Rule assertions
│   └── data/              # Test data generators
├── utils/
│   ├── multiUserManager.ts # Handles User A/B rotation & tokens
│   ├── reportExporter.ts   # Generates JSON/HTML reports
│   └── payloadCapture.ts   # Intercepts & stores HTTP traffic
├── scripts/               # Utility scripts (Report generation)
└── config/                # Global configuration loaders
assets/
└── report.html            # The HTML Report Template
```

---

## 🧩 Business Rules Coverage

| ID | Rule | Automation Logic |
| :--- | :--- | :--- |
| **BR-001** | **Max 20 Addresses** | Tests attempt to create a 21st address and **MUST** receive a `400/422` rejection. If `200 OK` is returned, the test fails (Security/Logic Bug). |
| **BR-002** | **Address Length** | Validates field constraints (max 50 chars). |
| **BR-003** | **Default Protection** | Attempts to delete a default address (Should Fail). |
| **BR-004** | **Single Default** | Verifies only one address is flagged `is_default: true` at any time. |

---

## ⚠️ Troubleshooting

| Issue | Likely Cause | Solution |
| :--- | :--- | :--- |
| **Tests Fail with 429** | Rate limit exhausted on both users. | Increase `request_delay` in `global_config.json`. |
| **401 Unauthorized** | Invalid credentials or expired token. | Check `user_one`/`user_two` in `global_config.json`. |
| **Empty Payloads** | Reporter can't find capture files. | Ensure `PayloadCapture` is enabled and tests are not skipping setup. |
| **"Setup Error"** | Data validation failed pre-request. | Check `diagnostic_notes` in the report for specific field errors (e.g., "floor must be numeric"). |

---

> _Generated for Gazzer QA Team_
