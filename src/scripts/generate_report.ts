/**
 * @file generate_report.ts
 * @description CLI entry point for post-execution report generation.
 *
 * Run after `npx playwright test` to transform the Playwright JSON output
 * into the project's structured JSON + HTML reports.
 *
 * Usage: `npx ts-node src/scripts/generate_report.ts`
 *
 * Reads:
 *   - test-results/execution-report.json (Playwright output)
 *   - .env (for BASE_URL, ENVIRONMENT, AUTH_EMAIL in report metadata)
 *
 * Writes:
 *   - reports/ClientAddresses_execution.json
 *   - reports/ClientAddresses_report.html
 *   - assets/customer_app/addresses_report_data.js
 *
 * @module generate_report
 */
import dotenv from 'dotenv';
import path from 'path';
import { ReportExporter } from '../utils/reportExporter';

// Load .env so report has access to BASE_URL, ENVIRONMENT, AUTH_EMAIL
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Paths - REMEDIATION: Reports go to /reports directory
const jsonPath = path.resolve(__dirname, '../../test-results/execution-report.json');
const reportsDir = path.resolve(__dirname, '../../reports');

console.log('Generating HTML Report from Playwright JSON output...');
console.log(`  JSON source: ${jsonPath}`);
console.log(`  Reports dir: ${reportsDir}`);

// FAIL FAST if report generation fails
ReportExporter.generateReport(jsonPath, reportsDir);
