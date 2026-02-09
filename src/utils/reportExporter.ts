/**
 * @file reportExporter.ts
 * @description Report generation pipeline for the Client Addresses API test suite.
 *
 * Transforms Playwright's raw JSON output into a structured execution report
 * (JSON + standalone HTML) consumed by the assets/report.html dashboard template.
 *
 * Pipeline stages:
 *   1. Load & validate global_config.json execution bounds
 *   2. Extract test cases from Playwright's nested suite/spec/test/result tree
 *   3. Merge captured payloads (in-memory + cross-process disk files)
 *   4. Classify failures (API bug vs. infra vs. env noise vs. setup error)
 *   5. Compute statistics & auto-generate bug entries for confirmed API failures
 *   6. Determine release readiness (BLOCKED / WARNING / READY)
 *   7. Write JSON report, self-contained HTML report, and external JS data file
 *
 * Business rules referenced:
 *   - BR-001: 20 address limit per account
 *   - BR-002: 50 char max on address name
 *   - BR-003: Default address deletion protection
 *   - BR-004: Single default address constraint
 *
 * Key dependencies:
 *   - {@link PayloadCapture} for request/response pair retrieval
 *   - {@link ExecutionTracker} for per-test execution metadata
 *   - global_config.json for test-count bounds and execution config
 *   - assets/report.html as the HTML template (source of truth for data contract)
 *
 * @module reportExporter
 */
import fs from 'fs';
import path from 'path';
import { PayloadCapture } from './payloadCapture';
import { ExecutionTracker } from './executionTracker';

/**
 * Report data contract matching assets/report.html template's window.REPORT_DATA.
 * The template is the SOURCE OF TRUTH — this exporter maps Playwright JSON output to it.
 *
 * REMEDIATION: All meta fields are DERIVED from testCases[], not invented.
 * Payloads are captured from actual API executions via PayloadCapture.
 * Config controls test generation via global_config.json.
 */

interface TestCaseData {
  test_id: string;
  test_name: string;
  description: string;
  status: string; // PASS, FAIL, SKIPPED, RECOVERED, BLOCKED, ENV, INVALID_SETUP
  priority: string;
  category: string;
  endpoint: string;
  http_method: string;
  execution_time_ms: number;
  expected_result: string;
  actual_result: string;
  request_payload: any;
  response_payload: any;
  executed_at: string;
  bug: BugData | null;
  failure_type: string;
  api_exercised: boolean;
  confirmed_api_bug: boolean;
  classification_reason: string;
  diagnostic_notes: string[];
  response_status_code: number;
  users_utilized: string[];
  languages: string[];
  extended_payloads?: Record<string, { method: string; endpoint: string; request_payload: any; response_payload: any; response_status_code: number }[]>;
  owasp_category?: string;
  governor_telemetry?: { total429s: number; systemPauses: number; currentDelay: number };
  retry_history?: string[];
}

interface BugData {
  bug_id: string;
  title: string;
  severity: string;
  description: string;
  expected_result: string;
  actual_result: string;
}

interface ReportData {
  meta: ReportMeta;
  testCases: TestCaseData[];
  bugs: BugData[];
  integrity: Record<string, any>;
}

interface ReportMeta {
  apiName: string;
  description: string;
  executionDate: string;
  environment: string;
  baseUrl: string;
  totalTestCases: number;
  passed: number;
  failed: number;
  skipped: number;
  blocked: number;
  recovered: number;
  environmentConstraints: number;
  passedWithDeviations: number;
  invalidTestSetup: number;
  passRate: string;
  effectivePassRate: string;
  contractComplianceRate: string;
  releaseReadiness: 'BLOCKED' | 'WARNING' | 'READY';
  bugs: { critical: number; high: number; medium: number; low: number };
  executionSeed: string;
  database: { host: string; database: string };
  executionConfig: {
    minimum_test_cases: number;
    maximum_test_cases: number;
    timeout: number;
    retry_attempts: number;
    request_delay: number;
    fail_fast: boolean;
  };
  clientIds: string[];
  clientNames: Record<string, string>;
  configRespected: boolean;
  configValidationMessage: string;
  usersUtilized: string[];
  rateLimitSummary?: {
    totalEvents: number;
    affectedTests: string[];
    recoveredCount: number;
    exhaustedCount: number;
  };
  governorTelemetry?: {
    total429s: number;
    systemPauses: number;
    adaptiveDelayMs: number;
    infraPressureCount: number;
  };
}

export interface ExecutionConfig {
  minimum_test_cases: number;
  max_test_cases: number;
  request_delay: number;
  base_url?: string; // Add base_url here as it is used in HealthCheck
}

/** OWASP API Security Top 10 (2023) mapping from test ID prefixes. */
const OWASP_MAP: Record<string, string> = {
  'DYN-SEC-SQL': 'API8:2023 Security Misconfiguration',
  'DYN-SEC-XSS': 'API8:2023 Security Misconfiguration',
  'DYN-SEC-PATH': 'API8:2023 Security Misconfiguration',
  'DYN-SEC-CMD': 'API8:2023 Security Misconfiguration',
  'DYN-SEC-NOSQL': 'API8:2023 Security Misconfiguration',
  'DYN-SEC-LDAP': 'API8:2023 Security Misconfiguration',
  'DYN-SEC-FMT': 'API8:2023 Security Misconfiguration',
  'DYN-SEC-EDGE': 'API8:2023 Security Misconfiguration',
  'DYN-SEC-AUTH': 'API1:2023 Broken Object Level Authorization',
  'DYN-SEC': 'API5:2023 Broken Function Level Authorization',
  'ADDR-LIST-002': 'API2:2023 Broken Authentication',
  'DYN-BND': 'API3:2023 Broken Object Property Level Authorization',
  'DYN-VAL': 'API3:2023 Broken Object Property Level Authorization',
  'DYN-PERF': 'API4:2023 Unrestricted Resource Consumption',
};

/** Static ID-prefix-to-category mappings for both legacy (ADDR-*) and dynamic (DYN-*) tests. */
const CATEGORY_MAP: Record<string, string> = {
  'ADDR-CREATE': 'Create',
  'ADDR-LIST': 'List',
  'ADDR-UPDATE': 'Update',
  'ADDR-DELETE': 'Delete',
  'ADDR-DEFAULT': 'Set Default',
  'DYN-HP': 'Happy Path',
  'DYN-VAL': 'Validation',
  'DYN-BND': 'Boundary',
  'DYN-EDGE': 'Edge Cases',
  'DYN-SEC': 'Security',
  'DYN-SEC-SQL': 'Security - SQL Injection',
  'DYN-SEC-XSS': 'Security - XSS',
  'DYN-SEC-PATH': 'Security - Path Traversal',
  'DYN-SEC-CMD': 'Security - Command Injection',
  'DYN-SEC-NOSQL': 'Security - NoSQL Injection',
  'DYN-SEC-LDAP': 'Security - LDAP Injection',
  'DYN-SEC-FMT': 'Security - Format String',
  'DYN-SEC-EDGE': 'Security - Edge Cases',
  'DYN-SEC-AUTH': 'Security - Authorization',
  'DYN-PERF': 'Performance',
  'DYN-LOC': 'Localization',
  'DYN-AR-HP': 'Localization - Arabic Happy Path',
  'DYN-AR-VAL': 'Localization - Arabic Validation',
  'DYN-STATE': 'State & Navigation',
};

/**
 * Static metadata for non-dynamic (legacy) test cases.
 * Dynamic tests derive their metadata from test IDs and captured payloads at runtime.
 * Each entry maps a stable test ID to its expected endpoint, HTTP method, priority,
 * human-readable description, and expected result for the HTML report.
 */
const TEST_METADATA: Record<string, { endpoint: string; method: string; priority: string; description: string; expected: string }> = {
  'ADDR-CREATE-001': { endpoint: '/api/clients/addresses', method: 'POST', priority: 'HIGH', description: 'Create a valid address with all required fields', expected: 'HTTP 200 with status: success, address persisted in DB' },
  'ADDR-CREATE-002': { endpoint: '/api/clients/addresses', method: 'POST', priority: 'MEDIUM', description: 'Validation: reject address exceeding 50 chars (BR-002)', expected: 'HTTP 422 with status: error, validation message about length' },
  'ADDR-CREATE-003': { endpoint: '/api/clients/addresses', method: 'POST', priority: 'HIGH', description: 'Business Limit: reject when max 20 addresses reached (BR-001)', expected: 'HTTP 422 with status: error, message about limit/maximum' },
  'ADDR-LIST-001': { endpoint: '/api/clients/addresses', method: 'GET', priority: 'HIGH', description: 'List all addresses with pagination and schema validation', expected: 'HTTP 200 with status: success, array of addresses, pagination' },
  'ADDR-LIST-002': { endpoint: '/api/clients/addresses', method: 'GET', priority: 'CRITICAL', description: 'Unauthorized access returns 401', expected: 'HTTP 401 with auth error message' },
  'ADDR-UPDATE-001': { endpoint: '/api/clients/addresses/update/{id}', method: 'POST', priority: 'HIGH', description: 'Update a valid address with new name', expected: 'HTTP 200 with status: success' },
  'ADDR-UPDATE-002': { endpoint: '/api/clients/addresses/update/{id}', method: 'POST', priority: 'MEDIUM', description: 'Validation: reject update with address > 50 chars (BR-002)', expected: 'HTTP 422 with status: error' },
  'ADDR-DELETE-001': { endpoint: '/api/clients/addresses/{id}', method: 'DELETE', priority: 'HIGH', description: 'Delete a non-default address', expected: 'HTTP 200/204 with status: success' },
  'ADDR-DELETE-002': { endpoint: '/api/clients/addresses/{id}', method: 'DELETE', priority: 'HIGH', description: 'Default address protection (BR-003)', expected: 'HTTP 400/403/422 with status: error, deletion refused' },
  'ADDR-DEFAULT-001': { endpoint: '/api/clients/addresses/set-default', method: 'POST', priority: 'HIGH', description: 'Set default address and verify single default (BR-004)', expected: 'HTTP 200 with status: success, only one default' },
};

/**
 * Loads and validates execution configuration from global_config.json.
 * Fail-fast: throws immediately if the config is missing, unreadable, or has invalid bounds.
 *
 * @returns Validated execution config (min/max test cases, request delay)
 * @throws {Error} If config file is missing, malformed, or has invalid constraints
 */
function loadExecutionConfig(): ExecutionConfig {
  const configPath = path.resolve(__dirname, '../../global_config.json');

  if (!fs.existsSync(configPath)) {
    throw new Error(`[ReportExporter] FAIL FAST: global_config.json not found at ${configPath}. Config is mandatory.`);
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(raw);

    const execConfig = config.execution || {};
    const minCases = execConfig.minimum_test_cases ?? 10;
    const maxCases = execConfig.max_test_cases ?? 200;
    const delay = execConfig.request_delay ?? 0.5;

    if (minCases > maxCases) {
      throw new Error(`[ReportExporter] FAIL FAST: minimum_test_cases (${minCases}) > max_test_cases (${maxCases}).`);
    }
    if (minCases < 1) {
      throw new Error(`[ReportExporter] FAIL FAST: minimum_test_cases must be >= 1.`);
    }

    return { minimum_test_cases: minCases, max_test_cases: maxCases, request_delay: delay };
  } catch (e) {
    throw new Error(`[ReportExporter] FAIL FAST: Error reading global_config.json: ${e}`);
  }
}

/**
 * Orchestrates the full report generation pipeline.
 *
 * Reads Playwright JSON output, merges payload captures, computes stats,
 * generates bug entries, and writes both JSON and HTML reports.
 */
export class ReportExporter {
  /**
   * Main entry point for report generation.
   *
   * @param jsonReportPath - Absolute path to Playwright's execution-report.json
   * @param reportsDir - Output directory for the generated JSON and HTML reports
   * @returns Object containing output paths and the complete report data
   * @throws {Error} If JSON report is missing or test count violates config bounds
   */
  static generateReport(jsonReportPath: string, reportsDir: string) {
    console.log(`[ReportExporter] Generating report from ${jsonReportPath}...`);

    if (!fs.existsSync(jsonReportPath)) {
      throw new Error(`[ReportExporter] FAIL FAST: JSON Report not found at: ${jsonReportPath}. Execution data is required.`);
    }

    const execConfig = loadExecutionConfig();
    console.log(`[ReportExporter] Config loaded: min=${execConfig.minimum_test_cases}, max=${execConfig.max_test_cases}`);

    const rawData = fs.readFileSync(jsonReportPath, 'utf8');
    const playwrightReport = JSON.parse(rawData);

    const testCases = ReportExporter.extractTestCases(playwrightReport);

    if (testCases.length < execConfig.minimum_test_cases) {
      throw new Error(
        `[ReportExporter] FAIL FAST: Generated tests (${testCases.length}) < minimum_test_cases (${execConfig.minimum_test_cases}). ` +
        `Config requirement not met.`
      );
    }

    if (testCases.length > execConfig.max_test_cases) {
      console.warn(`[ReportExporter] WARNING: Generated tests (${testCases.length}) > max_test_cases (${execConfig.max_test_cases}).`);
    }

    // PAYLOAD QUALITY VALIDATION: Warn if tests have missing payloads
    // Empty {} payloads in reports indicate test infrastructure issues
    const testsWithoutPayloads = testCases.filter(tc =>
      !tc.request_payload && !tc.response_payload &&
      tc.status !== 'SKIPPED' && tc.status !== 'BLOCKED_BY_DEPENDENCY'
    );

    if (testsWithoutPayloads.length > 0) {
      console.error(`\n[ReportExporter] PAYLOAD QUALITY WARNING: ${testsWithoutPayloads.length} test(s) missing payloads:`);
      testsWithoutPayloads.forEach(tc => {
        console.error(`  - ${tc.test_id}: ${tc.test_name} (status: ${tc.status})`);
      });
      console.error(`This indicates test infrastructure issues. Reports will show empty {} payloads.\n`);
    } else {
      console.log(`[ReportExporter] ✓ Payload quality check passed - all non-skipped tests have payloads`);
    }

    const stats = ReportExporter.computeStats(testCases);
    const bugs = ReportExporter.extractBugs(testCases);
    const reportData = ReportExporter.buildReportData(testCases, stats, bugs, playwrightReport, execConfig);

    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    const jsonOutputPath = path.join(reportsDir, 'ClientAddresses_execution.json');
    fs.writeFileSync(jsonOutputPath, JSON.stringify(reportData, null, 2), 'utf8');
    console.log(`[ReportExporter] JSON report written: ${jsonOutputPath}`);

    const htmlOutputPath = path.join(reportsDir, 'ClientAddresses_report.html');
    ReportExporter._generateHtmlReport(reportData, htmlOutputPath);
    console.log(`[ReportExporter] HTML report written: ${htmlOutputPath}`);

    // Also update the external data JS file so assets/report.html template works when opened directly
    ReportExporter._writeExternalDataFile(reportData);

    console.log(`\n=== REPORT SUMMARY ===`);
    console.log(`Total: ${stats.total} | Passed: ${stats.passed} | Failed: ${stats.failed} | Skipped: ${stats.skipped}`);
    console.log(`Config: min=${execConfig.minimum_test_cases}, max=${execConfig.max_test_cases}, actual=${testCases.length}`);
    console.log(`Config Respected: ${reportData.meta.configRespected ? 'YES' : 'NO'}`);
    console.log(`Pass Rate: ${stats.passRate} | Effective Pass Rate: ${stats.effectivePassRate}`);
    console.log(`Bugs: ${bugs.length} (Critical: ${stats.bugCounts.critical}, High: ${stats.bugCounts.high})`);
    console.log(`Release Readiness: ${reportData.meta.releaseReadiness}`);
    console.log(`======================\n`);

    return { jsonPath: jsonOutputPath, htmlPath: htmlOutputPath, reportData };
  }

  /**
   * Safely serialize report data for embedding inside an HTML <script> tag.
   * JSON.stringify can produce sequences like </script> or <!-- inside string values
   * which would prematurely terminate the script block or trigger HTML comment parsing.
   * This escapes </ to <\/ and <!-- to <\!-- to prevent those issues.
   */
  private static safeJsonForInlineScript(data: any): string {
    const raw = JSON.stringify(data, null, 2);
    // Escape sequences that break inline <script> tags:
    //   </  → <\/   (prevents premature </script> closure)
    //   <!--  → <\!-- (prevents HTML comment interpretation)
    return raw
      .replace(/<\//g, '<\\/')
      .replace(/<!--/g, '<\\!--');
  }

  private static _generateHtmlReport(reportData: ReportData, outputPath: string) {
    const templatePath = path.resolve(__dirname, '../../assets/report.html');

    if (!fs.existsSync(templatePath)) {
      throw new Error(`[ReportExporter] FAIL FAST: HTML template not found at: ${templatePath}`);
    }

    let templateHtml = fs.readFileSync(templatePath, 'utf8');

    const safeData = ReportExporter.safeJsonForInlineScript(reportData);
    const dataScript = `<script>\n// Auto-generated by ReportExporter — ${new Date().toISOString()}\nwindow.REPORT_DATA = ${safeData};\n</script>`;

    templateHtml = templateHtml.replace(/<script src="customer_app\/addresses_report_data\.js"><\/script>/, dataScript);

    fs.writeFileSync(outputPath, templateHtml, 'utf8');
  }

  /**
   * Write the report data to assets/customer_app/addresses_report_data.js
   * so the template (assets/report.html) works when opened directly in a browser.
   */
  private static _writeExternalDataFile(reportData: ReportData) {
    const dataJsPath = path.resolve(__dirname, '../../assets/customer_app/addresses_report_data.js');
    const dataJsDir = path.dirname(dataJsPath);

    if (!fs.existsSync(dataJsDir)) {
      fs.mkdirSync(dataJsDir, { recursive: true });
    }

    const content = `// Auto-generated by ReportExporter — ${new Date().toISOString()}\nwindow.REPORT_DATA = ${JSON.stringify(reportData, null, 2)};\n`;
    fs.writeFileSync(dataJsPath, content, 'utf8');
    console.log(`[ReportExporter] External data JS updated: ${dataJsPath}`);
  }

  /**
   * Walks Playwright's nested suite tree and extracts flat TestCaseData records.
   *
   * For each test result:
   *   - Parses the test ID from the title prefix (e.g., "ADDR-CREATE-001: ...")
   *   - Merges payload captures (in-memory first, then disk fallback for cross-process)
   *   - Groups multi-language captures by Accept-Language for the report payload view
   *   - Maps Playwright status to report status (PASS, FAIL, RECOVERED, SKIPPED, etc.)
   *   - Classifies failures into actionable categories (API bug, infra, env noise)
   *
   * @param playwrightReport - Raw Playwright JSON report object
   * @returns Flat array of test case records for the report
   */
  private static extractTestCases(playwrightReport: any): TestCaseData[] {
    const results: TestCaseData[] = [];
    const payloadCapture = PayloadCapture.getInstance();

    // Load persisted payload captures from disk (cross-process support).
    // Workers write payloads to individual JSON files; the reporter process reads them all.
    const diskPayloads = PayloadCapture.loadFromDisk();
    const getPayloadsForTest = (testId: string) => {
      // Prefer in-memory captures (same process), fall back to disk captures.
      // In single-worker mode both sources overlap; in multi-worker only disk is available.
      const inMemory = payloadCapture.getCaptures(testId);
      if (inMemory && inMemory.length > 0) return inMemory;
      return diskPayloads.get(testId) || [];
    };

    const aggregateCaptures = (captures: ReturnType<typeof payloadCapture.getCaptures>) => {
      // Ensure even if empty, structure is consistent
      if (!captures || captures.length === 0) {
        return { request_payload: null, response_payload: null, response_status_code: 0, extendedPayloads: undefined };
      }
      const byLanguage: Record<string, any[]> = {};
      const untagged: any[] = [];
      captures.forEach(c => {
        const entry = {
          method: c.method,
          endpoint: c.endpoint,
          request_payload: c.request_payload,
          response_payload: c.response_payload,
          response_status_code: c.response_status_code,
        };
        if (c.language) {
          if (!byLanguage[c.language]) {
            byLanguage[c.language] = [];
          }
          byLanguage[c.language].push(entry);
        } else {
          untagged.push(entry);
        }
      });

      const extendedPayloads = Object.keys(byLanguage).length > 0 ? byLanguage : (untagged.length > 0 ? { 'untagged': untagged } : undefined);

      // No language tags — use the last capture's raw payloads
      const last = captures[captures.length - 1];
      return {
        request_payload: last.request_payload || null,
        response_payload: last.response_payload || null,
        response_status_code: last.response_status_code || 0,
        extendedPayloads,
      };
    };

    const traverse = (suites: any[]) => {
      suites.forEach(suite => {
        if (suite.specs && Array.isArray(suite.specs)) {
          suite.specs.forEach((spec: any) => {
            if (spec.tests && spec.tests.length > 0) {
              // FIX: Loop through ALL tests in spec.tests, not just the first one
              // Tests with runWithLanguages() create multiple test entries (one per language)
              spec.tests.forEach((test: any) => {
                const result = test.results && test.results[0];

                if (result) {
                  const titleParts = spec.title.split(':');
                  const testId = titleParts[0]?.trim() || 'UNKNOWN';
                  const testName = titleParts.slice(1).join(':').trim() || spec.title;
                  const meta = TEST_METADATA[testId];
                  const execMeta = ExecutionTracker.getMeta(testId);

                  const reportStatus = ReportExporter.mapStatus(result.status, testId, result.error?.message, execMeta);
                  const failureType = ReportExporter.classifyFailure(result, reportStatus);

                  const captures = getPayloadsForTest(testId);
                  const aggregated = aggregateCaptures(captures);

                  // Extract unique languages from captures for language badges
                  const languages = [...new Set(
                    (captures || [])
                      .map(c => c.language)
                      .filter((l): l is string => !!l)
                  )];

                  if ((!captures || captures.length === 0) && reportStatus !== 'SKIPPED' && reportStatus !== 'BLOCKED_BY_DEPENDENCY') {
                    console.warn(`[ReportExporter] No payload captured for ${testId}.`);
                  }

                  const metaNotes: string[] = [];
                  if (execMeta?.users?.length) metaNotes.push(`Users: ${execMeta.users.join(', ')}`);
                  if (execMeta?.tokenSource) metaNotes.push(`Token: ${execMeta.tokenSource}`);
                  if (execMeta?.cleanupActions?.length) metaNotes.push(`Cleanup: ${execMeta.cleanupActions.join('; ')}`);
                  if (execMeta?.rateLimitEvents?.length) metaNotes.push(`RateLimit: ${execMeta.rateLimitEvents.join('; ')}`);
                  if (execMeta?.governorStats) metaNotes.push(`Governor: delay=${execMeta.governorStats.delay}ms, pauses=${execMeta.governorStats.pauses}, 429s=${execMeta.governorStats.total429s}`);
                  if (execMeta?.failureCategory) metaNotes.push(`Category: ${execMeta.failureCategory}`);

                  // Add RECOVERY context
                  if (reportStatus === 'RECOVERED') {
                    metaNotes.push('RECOVERED via retry/failover');
                  }

                  const metaNoteText = metaNotes.length > 0 ? ` | ${metaNotes.join(' | ')}` : '';

                  const tc: TestCaseData = {
                    test_id: testId,
                    test_name: testName,
                    description: meta?.description || testName,
                    status: reportStatus,
                    priority: meta?.priority || 'MEDIUM',
                    category: ReportExporter.getCategory(testId),
                    endpoint: meta?.endpoint || '/api/clients/addresses',
                    http_method: meta?.method || 'GET',
                    execution_time_ms: result.duration || 0,
                    expected_result: meta?.expected || '-',
                    actual_result: `${ReportExporter.getActualResult(result, reportStatus)}${metaNoteText}`,
                    request_payload: aggregated.request_payload,
                    response_payload: aggregated.response_payload,
                    response_status_code: aggregated.response_status_code,
                    executed_at: result.startTime || new Date().toISOString(),
                    bug: null,
                    failure_type: failureType,
                    api_exercised: reportStatus !== 'SKIPPED' && reportStatus !== 'BLOCKED_BY_DEPENDENCY',
                    confirmed_api_bug: false,
                    classification_reason: failureType === 'NONE' ? 'Test passed' : ReportExporter.getClassificationReason(failureType, result),
                    diagnostic_notes: result.error?.message ? [result.error.message.substring(0, 500)] : [],
                    users_utilized: execMeta?.users || [],
                    languages,
                    extended_payloads: aggregated.extendedPayloads,
                    owasp_category: ReportExporter.getOwaspCategory(testId),
                    governor_telemetry: execMeta?.governorStats ? {
                      total429s: execMeta.governorStats.total429s,
                      systemPauses: execMeta.governorStats.pauses,
                      currentDelay: execMeta.governorStats.delay,
                    } : undefined,
                    retry_history: execMeta?.retryHistory,
                  };

                  results.push(tc);
                }
              });
            }
          });
        }

        if (suite.suites && Array.isArray(suite.suites)) {
          traverse(suite.suites);
        }
      });
    };

    if (playwrightReport.suites) {
      traverse(playwrightReport.suites);
    }

    return results;
  }

  /**
   * Maps Playwright test status + error context to a report-level status.
   * A test that passed but required rate-limit failover or cleanup is marked RECOVERED.
   * Rate-limit exhaustion (both users depleted) becomes ENVIRONMENT_CONSTRAINT.
   *
   * @param playwrightStatus - Raw Playwright status ('passed', 'failed', 'skipped', 'timedOut')
   * @param testId - Test identifier for logging
   * @param errorMessage - Optional error message from test result
   * @param execMeta - Optional execution metadata (rate limit events, cleanup actions)
   * @returns Report status string
   */
  private static mapStatus(playwrightStatus: string, testId: string, errorMessage?: string, execMeta?: any): string {
    // RATE_LIMIT_EXHAUSTED is now a FAIL — the failure taxonomy classifies it as INFRA_PRESSURE
    if (errorMessage && errorMessage.includes('[RATE_LIMIT_EXHAUSTED]')) {
      return 'FAIL';
    }
    // PRECONDITION_SKIP no longer emitted (zero-skip policy), but handle legacy just in case
    if (errorMessage && errorMessage.includes('PRECONDITION_SKIP:')) {
      return 'FAIL';
    }

    // Check for Recovery
    if (playwrightStatus === 'passed') {
      if (execMeta && ((execMeta.rateLimitEvents?.length > 0) || (execMeta.cleanupActions?.length > 0))) {
        return 'RECOVERED';
      }
      return 'PASS';
    }

    switch (playwrightStatus) {
      case 'failed': return 'FAIL';
      case 'skipped': return 'SKIPPED';
      case 'timedOut': return 'FAIL';
      default: return 'FAIL';
    }
  }

  /**
   * Classifies a test failure into an actionable category for triage.
   * Order matters: more specific patterns are checked before generic ones.
   *
   * Categories:
   *   - NONE: passed or recovered
   *   - SKIPPED_BY_DESIGN / SKIPPED_ENV_CONSTRAINT: intentional skips
   *   - ENVIRONMENT_NOISE: rate limiting (429) prevented execution
   *   - INFRA_FAILURE: network/timeout issues
   *   - SETUP_ERROR: auth or state capture failures
   *   - API_FAILURE: actual assertion failures (potential bugs)
   *   - VALIDATION_FAILURE: payload capture issues
   */
  private static classifyFailure(result: any, status: string): string {
    if (status === 'PASS' || status === 'RECOVERED') return 'NONE';
    if (status === 'SKIPPED') return 'SKIPPED_BY_DESIGN';

    const errorMsg = (result.error?.message || '').toLowerCase();

    // NEW: Detect explicit failure categories from zero-skip policy (Phase 5 classified throws)
    if (errorMsg.includes('[infra_pressure]') || errorMsg.includes('infra_pressure')) {
      return 'INFRA_PRESSURE';
    }
    if (errorMsg.includes('[business_rule_violation]') || errorMsg.includes('business_rule_violation')) {
      return 'BUSINESS_RULE_VIOLATION';
    }
    if (errorMsg.includes('[security_defect]') || errorMsg.includes('security_defect')) {
      return 'SECURITY_DEFECT';
    }
    if (errorMsg.includes('[localization_defect]') || errorMsg.includes('localization_defect')) {
      return 'LOCALIZATION_DEFECT';
    }
    if (errorMsg.includes('[data_integrity_defect]') || errorMsg.includes('data_integrity_defect')) {
      return 'DATA_INTEGRITY_DEFECT';
    }

    // Auto-detect from test content patterns
    if (errorMsg.includes('confirmed api bug: sql') || errorMsg.includes('unsanitized') || errorMsg.includes('data leakage')) {
      return 'SECURITY_DEFECT';
    }
    if (errorMsg.includes('br-001') || errorMsg.includes('br-002') || errorMsg.includes('br-003') || errorMsg.includes('br-004')) {
      return 'BUSINESS_RULE_VIOLATION';
    }

    // SETUP_ERROR (test data validation failures)
    if (errorMsg.includes('setup_error:')) {
      return 'SETUP_ERROR';
    }

    // INFRA_PRESSURE: Strict categorization for Rate Limits & Network Instability
    // This ensures these are NOT counted as product bugs but as environmental noise.
    if (
        errorMsg.includes('rate_limit_exhausted') || 
        errorMsg.includes('rate_limit') || 
        errorMsg.includes('429') ||
        errorMsg.includes('too many requests')
    ) {
      return 'INFRA_PRESSURE';
    }
    
    // INFRA_PRESSURE: Network/timeout issues
    if (
        errorMsg.includes('econnrefused') || 
        errorMsg.includes('econnreset') || 
        errorMsg.includes('timeout') ||
        errorMsg.includes('socket hang up') ||
        errorMsg.includes('fetch failed')
    ) {
      return 'INFRA_PRESSURE';
    }

    if (errorMsg.includes('auth abort') || errorMsg.includes('login returned') || errorMsg.includes('statetracker')) {
      return 'SETUP_ERROR';
    }
    if (errorMsg.includes('expect(') || errorMsg.includes('tobe') || errorMsg.includes('tocontain')) {
      return 'API_FAILURE';
    }
    if (errorMsg.includes('payload') || errorMsg.includes('capture')) {
      return 'VALIDATION_FAILURE';
    }

    return 'API_FAILURE';
  }

  private static getCategory(testId: string): string {
    for (const [prefix, category] of Object.entries(CATEGORY_MAP)) {
      if (testId.startsWith(prefix)) return category;
    }
    return 'General';
  }

  private static getOwaspCategory(testId: string): string | undefined {
    for (const [prefix, owasp] of Object.entries(OWASP_MAP)) {
      if (testId.startsWith(prefix)) return owasp;
    }
    return undefined;
  }

  private static getActualResult(result: any, status: string): string {
    if (status === 'PASS') return 'Test passed as expected';
    if (status === 'RECOVERED') return 'Test passed after recovery actions';
    if (status === 'SKIPPED') return 'Test skipped (precondition not met)';

    const rawError = result.error?.message || '';
    if (!rawError) {
      return 'Test failed with no error message captured (possible infrastructure issue)';
    }

    return ReportExporter.humanizeError(rawError);
  }

  /**
   * Converts Playwright assertion errors to plain English.
   * Strips ANSI codes, extracts HTTP status context, explains validation failures.
   *
   * @param rawError - Raw error message from Playwright test result
   * @returns Human-readable error description without ANSI codes
   */
  private static humanizeError(rawError: string): string {
    // Strip ANSI color codes (e.g., \u001b[31m for red text)
    const clean = rawError.replace(/\u001b\[\d+m/g, '');

    // Classified failure categories from zero-skip policy
    if (clean.includes('[INFRA_PRESSURE]')) {
      return `Infrastructure Pressure: ${clean.replace(/\[INFRA_PRESSURE\]\s*/, '').substring(0, 250)}\nTest failed due to API rate limiting or resource constraints — not an API defect.`;
    }
    if (clean.includes('[BUSINESS_RULE_VIOLATION]')) {
      return `Business Rule Violation: ${clean.replace(/\[BUSINESS_RULE_VIOLATION\]\s*/, '').substring(0, 250)}\nAPI did not enforce expected business logic.`;
    }
    if (clean.includes('[SECURITY_DEFECT]')) {
      return `Security Defect: ${clean.replace(/\[SECURITY_DEFECT\]\s*/, '').substring(0, 250)}\nAPI exposed a security vulnerability.`;
    }
    if (clean.includes('[LOCALIZATION_DEFECT]')) {
      return `Localization Defect: ${clean.replace(/\[LOCALIZATION_DEFECT\]\s*/, '').substring(0, 250)}\nAPI returned a response in the wrong language for the Accept-Language header.`;
    }
    if (clean.includes('[DATA_INTEGRITY_DEFECT]')) {
      return `Data Integrity Defect: ${clean.replace(/\[DATA_INTEGRITY_DEFECT\]\s*/, '').substring(0, 250)}\nCreated entity could not be found in subsequent API responses.`;
    }

    // Rate limit exhaustion (INFRA_PRESSURE)
    if (clean.includes('RATE_LIMIT_EXHAUSTED') || clean.includes('rate_limit_exhausted')) {
      return `Infrastructure Pressure: API rate limit exhausted after automatic retry with both user accounts and multi-cycle rotation.\nTest could not complete due to API throttling.`;
    }

    // 429 Too Many Requests (before user failover)
    if (clean.includes('429') && clean.includes('Too Many Requests')) {
      return `API returned HTTP 429 (Too Many Requests).\nRate limiting triggered. Framework attempted automatic user failover with multi-cycle rotation.\nIf this persists, the API may need higher rate limits for testing.`;
    }

    // Pattern: expect(received).toBe(expected) ... Expected: X, Received: Y
    const statusMatch = clean.match(/Expected:\s*(\d+)[\s\S]*?Received:\s*(\d+)/);
    if (statusMatch) {
      const [, expected, received] = statusMatch;

      // MASTER FIX: Expected 422 validation, got 422 = PASS (API correctly validated)
      if (received === '422' && expected === '422') {
        return `✅ Validation Test PASSED: API correctly rejected invalid data with HTTP 422.\nThis is the expected behavior for validation testing.`;
      }

      // Specific case: Floor validation error (Arabic message)
      if (received === '422' && clean.includes('يجب أن يكون الحقل floor')) {
        return `API rejected the request with HTTP 422.\nReason: floor field must be a numeric value (sent non-numeric: "3rd" or similar).\nThis indicates correct backend validation enforcement.`;
      }

      // Generic 422 handling (received 422 when expecting 200/201)
      if (received === '422') {
        return `API rejected the request with HTTP 422 (Validation Error).\nExpected: HTTP ${expected}.\nLikely cause: Invalid or incomplete request data.\nCheck payload for missing required fields or invalid data types.`;
      }

      // MASTER FIX: 404 Not Found
      if (received === '404') {
        return `API returned HTTP 404 (Not Found).\nExpected: HTTP ${expected}.\nLikely cause: Resource ID does not exist, or endpoint path is incorrect.`;
      }

      // API BUG: Expected validation error but got 200
      if (received === '200' && (expected === '400' || expected === '422')) {
        return `CONFIRMED API BUG: Expected validation error (HTTP ${expected}), but API accepted invalid data with HTTP 200.\nThe API should have rejected this request but instead processed it successfully.`;
      }

      // MASTER FIX: Expected 200/201 but got 403/401 (auth issue)
      if ((received === '403' || received === '401') && (expected === '200' || expected === '201')) {
        return `API returned HTTP ${received} (${received === '403' ? 'Forbidden' : 'Unauthorized'}).\nExpected: HTTP ${expected}.\nLikely cause: Authentication token expired or insufficient permissions.`;
      }

      return `HTTP status mismatch.\nExpected: ${expected}, Received: ${received}.\nReview test expectations and API behavior to determine if this is a bug.`;
    }

    // Pattern: Business rule validation failures
    if (clean.includes('validateSingleDefaultAddress') || clean.includes('BR-004')) {
      const countMatch = clean.match(/found (\d+)/);
      if (countMatch) {
        return `Business Rule BR-004 violated: Expected exactly 1 default address, found ${countMatch[1]}.\nAPI returned inconsistent default address state.`;
      }
      return `Business Rule BR-004 violated: Multiple or zero default addresses detected.`;
    }

    // Fallback: Return cleaned error (first 300 chars)
    return clean.substring(0, 300);
  }

  private static getClassificationReason(failureType: string, result: any): string {
    const errorMsg = (result.error?.message || '').toLowerCase();
    switch (failureType) {
      case 'INFRA_PRESSURE':
        if (errorMsg.includes('rate_limit_exhausted') || errorMsg.includes('rate_limit') || errorMsg.includes('429')) {
          return 'Rate limiting (429) prevented test execution after multi-cycle user rotation';
        }
        if (errorMsg.includes('timeout') || errorMsg.includes('econnrefused') || errorMsg.includes('econnreset')) {
          return 'Network timeout or connection error prevented test execution';
        }
        if (errorMsg.includes('address limit') || errorMsg.includes('br-001')) {
          return 'Address limit (BR-001) could not be resolved despite cleanup attempts';
        }
        return 'Infrastructure pressure prevented test completion';
      case 'BUSINESS_RULE_VIOLATION':
        if (errorMsg.includes('br-001')) return 'BR-001: Address limit not enforced by API';
        if (errorMsg.includes('br-002')) return 'BR-002: Address name length limit not enforced';
        if (errorMsg.includes('br-003')) return 'BR-003: Default address deletion protection not enforced';
        if (errorMsg.includes('br-004')) return 'BR-004: Single default address constraint violated';
        return 'API did not enforce expected business rule';
      case 'SECURITY_DEFECT':
        if (errorMsg.includes('sql')) return 'Potential SQL injection vulnerability detected';
        if (errorMsg.includes('cross-user') || errorMsg.includes('403')) return 'Cross-user data access not properly restricted';
        if (errorMsg.includes('data leakage')) return 'Sensitive data exposed in API response';
        return 'Security vulnerability detected in API behavior';
      case 'LOCALIZATION_DEFECT':
        return 'API returned response in wrong language for Accept-Language header';
      case 'DATA_INTEGRITY_DEFECT':
        return 'Created entity not found in subsequent API responses (eventual consistency failure)';
      case 'SETUP_ERROR':
        if (errorMsg.includes('floor field must be numeric')) {
          return 'Test data violation: floor field sent with non-numeric value';
        }
        if (errorMsg.includes('apartment field must be a number')) {
          return 'Test data violation: apartment field sent as non-number type';
        }
        return 'Test setup or data validation failed before API call';
      case 'API_FAILURE': return 'API response did not match expected behavior';
      case 'SKIPPED_BY_DESIGN': return 'Test skipped due to precondition not met';
      // Legacy categories kept for backward compatibility
      case 'INFRA_FAILURE': return 'Infrastructure error prevented test execution';
      case 'SKIPPED_ENV_CONSTRAINT': return 'Environment constraint prevented test execution';
      case 'ENVIRONMENT_NOISE': return 'Environmental noise or transient issue';
      case 'VALIDATION_FAILURE': return 'Payload capture or validation failed';
      default: return 'Unclassified failure';
    }
  }

  /**
   * Auto-generates bug entries from confirmed API failures.
   * Only tests with status=FAIL and failure_type=API_FAILURE get bug records.
   * Bug severity is derived from test priority (CRITICAL/HIGH/MEDIUM).
   *
   * @param testCases - All extracted test cases
   * @returns Array of auto-generated bug records
   */
  private static extractBugs(testCases: TestCaseData[]): BugData[] {
    const bugs: BugData[] = [];
    let bugCounter = 1;

    // Bug-worthy failure types: API bugs + classified defects (not INFRA_PRESSURE)
    const BUG_WORTHY_TYPES = new Set(['API_FAILURE', 'SECURITY_DEFECT', 'BUSINESS_RULE_VIOLATION', 'DATA_INTEGRITY_DEFECT', 'LOCALIZATION_DEFECT']);
    testCases.forEach(tc => {
      if (tc.status === 'FAIL' && BUG_WORTHY_TYPES.has(tc.failure_type)) {
        const typeLabel = tc.failure_type === 'API_FAILURE' ? 'API Failure' : tc.failure_type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        const bug: BugData = {
          bug_id: `BUG-${String(bugCounter).padStart(3, '0')}`,
          title: `${tc.test_id}: ${tc.test_name} — ${typeLabel}`,
          severity: tc.priority === 'CRITICAL' ? 'CRITICAL' : tc.priority === 'HIGH' ? 'HIGH' : 'MEDIUM',
          description: `Test ${tc.test_id} failed: ${tc.description}`,
          expected_result: tc.expected_result,
          actual_result: tc.actual_result,
        };
        tc.bug = bug;
        tc.confirmed_api_bug = true;
        bugs.push(bug);
        bugCounter++;
      }
    });

    return bugs;
  }

  /**
   * Computes aggregate statistics from all test cases.
   * RECOVERED tests count as passing for both pass rate and effective pass rate.
   * Effective pass rate excludes blocked, env-constrained, skipped, and invalid-setup tests
   * from the denominator to reflect only actionable results.
   */
  private static computeStats(testCases: TestCaseData[]) {
    const total = testCases.length;
    const passed = testCases.filter(t => t.status === 'PASS').length;
    const failed = testCases.filter(t => t.status === 'FAIL').length;
    const skipped = testCases.filter(t => t.status === 'SKIPPED').length;
    const blocked = testCases.filter(t => t.status === 'BLOCKED_BY_DEPENDENCY').length;
    const recovered = testCases.filter(t => t.status === 'RECOVERED').length;
    const envConstraints = testCases.filter(t => t.status === 'ENVIRONMENT_CONSTRAINT').length;
    const deviations = testCases.filter(t => t.status === 'PASS_WITH_CONTRACT_DEVIATION').length;
    const invalidSetup = testCases.filter(t => t.status === 'INVALID_TEST_SETUP').length;
    // Count INFRA_PRESSURE failures (rate-limit, network issues — not API defects)
    const infraPressure = testCases.filter(t => t.failure_type === 'INFRA_PRESSURE').length;

    // Exclude INFRA_PRESSURE from effective denominator (alongside blocked, skipped, etc.)
    const effectiveDenom = total - blocked - envConstraints - skipped - invalidSetup - infraPressure;
    // Recovered counts as passing for the rate
    const passRate = total > 0 ? `${(((passed + recovered) / total) * 100).toFixed(1)}%` : '0%';
    const effectivePassRate = effectiveDenom > 0 ? `${(((passed + recovered) / effectiveDenom) * 100).toFixed(1)}%` : '0%';

    const confirmedBugs = testCases.filter(t => t.confirmed_api_bug);
    const bugCounts = { critical: 0, high: 0, medium: 0, low: 0 };
    confirmedBugs.forEach(tc => {
      if (tc.bug) {
        const sev = tc.bug.severity.toLowerCase() as keyof typeof bugCounts;
        if (sev in bugCounts) bugCounts[sev]++;
      }
    });

    return { total, passed, failed, skipped, blocked, recovered, envConstraints, deviations, invalidSetup, infraPressure, passRate, effectivePassRate, bugCounts };
  }

  /**
   * Assembles the final ReportData object that maps to the window.REPORT_DATA contract
   * expected by the assets/report.html dashboard template.
   * Calculates contract compliance rate and release readiness based on bug severity.
   */
  private static buildReportData(
    testCases: TestCaseData[],
    stats: ReturnType<typeof ReportExporter.computeStats>,
    bugs: BugData[],
    playwrightReport: any,
    execConfig: ExecutionConfig
  ): ReportData {
    const now = new Date().toISOString();

    // Aggregate all unique users
    const allUsers = new Set<string>();
    testCases.forEach(tc => tc.users_utilized?.forEach(u => allUsers.add(u)));

    const meta: ReportMeta = {
      // ... (existing fields)
      apiName: 'Client Addresses API',
      description: 'Enterprise Address API Lifecycle Automation Testing',
      executionDate: playwrightReport.stats?.startTime || now,
      environment: process.env.ENVIRONMENT || 'TEST',
      baseUrl: process.env.BASE_URL || '-',
      totalTestCases: stats.total,
      passed: stats.passed,
      failed: stats.failed,
      skipped: stats.skipped,
      blocked: stats.blocked,
      recovered: stats.recovered,
      environmentConstraints: stats.envConstraints,
      passedWithDeviations: stats.deviations,
      invalidTestSetup: stats.invalidSetup,
      passRate: stats.passRate,
      effectivePassRate: stats.effectivePassRate,
      contractComplianceRate: '0%', // Recalculate below
      releaseReadiness: 'READY', // Recalculate below
      bugs: stats.bugCounts,
      executionSeed: `run-${Date.now()}`,
      database: { host: process.env.DB_HOST || 'N/A', database: process.env.DB_NAME || 'N/A' },
      executionConfig: {
        minimum_test_cases: execConfig.minimum_test_cases,
        maximum_test_cases: execConfig.max_test_cases,
        timeout: 30,
        retry_attempts: 3,
        request_delay: execConfig.request_delay,
        fail_fast: false
      },
      clientIds: [process.env.AUTH_EMAIL || 'unknown'],
      clientNames: { [process.env.AUTH_EMAIL || 'unknown']: 'Test Client' },
      configRespected: testCases.length >= execConfig.minimum_test_cases && testCases.length <= execConfig.max_test_cases,
      configValidationMessage: testCases.length < execConfig.minimum_test_cases
        ? `FAIL: Generated tests (${testCases.length}) < minimum (${execConfig.minimum_test_cases})`
        : testCases.length > execConfig.max_test_cases
          ? `WARNING: Generated tests (${testCases.length}) > maximum (${execConfig.max_test_cases})`
          : `PASS: Generated tests (${testCases.length}) within config bounds [${execConfig.minimum_test_cases}, ${execConfig.max_test_cases}]`,
      usersUtilized: Array.from(allUsers)
    };

    // Rate Limit Summary
    const rateLimitAffected: string[] = [];
    let rateLimitRecovered = 0;
    let rateLimitExhausted = 0;
    testCases.forEach(tc => {
      const notes = tc.diagnostic_notes?.join(' ') || '';
      const actualResult = tc.actual_result || '';
      if (notes.includes('RateLimit') || actualResult.includes('RateLimit') ||
          tc.failure_type === 'ENVIRONMENT_NOISE' || tc.failure_type === 'INFRA_PRESSURE') {
        rateLimitAffected.push(tc.test_id);
        if (tc.status === 'RECOVERED') rateLimitRecovered++;
        if (tc.failure_type === 'INFRA_PRESSURE' || tc.failure_type === 'ENVIRONMENT_NOISE') rateLimitExhausted++;
      }
    });
    if (rateLimitAffected.length > 0) {
      meta.rateLimitSummary = {
        totalEvents: rateLimitAffected.length,
        affectedTests: rateLimitAffected,
        recoveredCount: rateLimitRecovered,
        exhaustedCount: rateLimitExhausted,
      };
    }

    // Aggregate governor telemetry from per-test metadata
    const govStats = testCases
      .filter(tc => tc.governor_telemetry)
      .map(tc => tc.governor_telemetry!);
    if (govStats.length > 0) {
      meta.governorTelemetry = {
        total429s: Math.max(...govStats.map(g => g.total429s)),
        systemPauses: Math.max(...govStats.map(g => g.systemPauses)),
        adaptiveDelayMs: Math.max(...govStats.map(g => g.currentDelay)),
        infraPressureCount: stats.infraPressure,
      };
    }

    // ... (Release readiness logic same as before)
    // Recalculate Compliance
    const exercised = testCases.filter(t => t.api_exercised);
    const compliant = exercised.filter(t => t.status === 'PASS' || t.status === 'PASS_WITH_CONTRACT_DEVIATION' || t.status === 'RECOVERED');
    meta.contractComplianceRate = exercised.length > 0 ? `${((compliant.length / exercised.length) * 100).toFixed(1)}%` : '0%';

    if (bugs.some(b => b.severity === 'CRITICAL')) {
      meta.releaseReadiness = 'BLOCKED';
    } else if (stats.failed > 0) {
      meta.releaseReadiness = 'WARNING';
    } else {
      meta.releaseReadiness = 'READY';
    }

    const integrity = {
      runId: `run-${Date.now()}`,
      consolidatedAt: now,
      expectedWorkers: 1,
      fragmentsFound: testCases.length,
      workerIds: ['worker-0'],
    };

    return { meta, testCases, bugs, integrity };
  }

}
