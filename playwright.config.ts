/**
 * @file playwright.config.ts
 * @description Playwright Test configuration for the Client Addresses API suite.
 *
 * Key design decisions:
 *   - timeout: 120s — dynamic tests with rate-limit retries and capacity cleanup
 *     can exceed the default 30s, especially under API throttling
 *   - retries: 0 — business-logic retries are handled internally by the
 *     controller layer; runner-level retries would mask real failures
 *   - workers: 1 — sequential execution avoids auth storms (429) and ensures
 *     state tracker consistency across tests
 *   - JSON reporter feeds into the custom {@link ReportExporter} pipeline
 *
 * @module playwright.config
 */
import { PlaywrightTestConfig } from '@playwright/test';
import { ENV } from './src/config/env';

const config: PlaywrightTestConfig = {
  globalSetup: './src/config/globalSetup.ts',
  testDir: './src/api/specs',
  timeout: 180000, // 180s — governor cooldowns + multi-cycle rotation can extend test duration
  retries: 0, // Business logic retries handled in Controller. Test runner retries disabled to avoid masking real failures.
  workers: 1, // Single worker to prevent auth storm (429). All specs run sequentially in one process.
  use: {
    baseURL: ENV.BASE_URL,
    extraHTTPHeaders: {
      'Accept': 'application/json',
    },
    trace: 'retain-on-failure',
  },
  reporter: [
      ['list'],
      ['json', { outputFile: 'test-results/execution-report.json' }] 
      // We will generate the specialized JSON/HTML report manually via utils/reportExporter.ts 
      // but Playwright's default JSON reporter is a good backup/input.
      // Spec says "Playwright -> execution-report.json -> api-test-report.html". 
      // I should probably use a custom reporter OR post-process the JSON.
  ],
};

export default config;
