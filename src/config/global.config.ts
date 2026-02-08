/**
 * @file global.config.ts
 * @description Centralized configuration loader merging global_config.json with .env overrides.
 *
 * Load order:
 *   1. global_config.json (file-based, includes multi-user credentials and execution bounds)
 *   2. .env variables (override base URL, auth, delays, retries)
 *
 * Fail-fast: throws immediately if global_config.json is missing or no primary
 * user credentials can be resolved from either source.
 *
 * Consumed by virtually every module in the framework.
 *
 * @module global.config
 */
import fs from 'fs';
import path from 'path';
import { ENV } from './env';

type UserCredentials = { login: string; password: string };
type ExecutionConfig = {
  minimum_test_cases: number;
  max_test_cases: number;
  request_delay: number;
  cleanup_enabled: boolean;
  cleanup_mode: 'partial' | 'full';
};

/**
 * Loads and parses global_config.json from the project root.
 * @throws {Error} If the config file is missing or not valid JSON
 */
function loadGlobalConfig() {
  const configPath = path.resolve(__dirname, '../../global_config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error(`[GlobalConfig] global_config.json not found at ${configPath}`);
  }

  const raw = fs.readFileSync(configPath, 'utf8');
  return JSON.parse(raw);
}

const jsonConfig = loadGlobalConfig();
const apiBaseUrl = jsonConfig?.api?.base_url || ENV.BASE_URL;

if (!apiBaseUrl) {
  throw new Error('[GlobalConfig] Missing base_url. Provide in global_config.json or BASE_URL env var.');
}

const userOne: UserCredentials | null = jsonConfig?.app_bases?.customer?.authentication?.user_one || null;
const userTwo: UserCredentials | null = jsonConfig?.app_bases?.customer?.authentication?.user_two || null;

const fallbackUser: UserCredentials | null = ENV.AUTH_EMAIL && ENV.AUTH_PASSWORD
  ? { login: ENV.AUTH_EMAIL, password: ENV.AUTH_PASSWORD }
  : null;

const primaryUser = userOne || fallbackUser;
if (!primaryUser) {
  throw new Error('[GlobalConfig] Missing primary user credentials. Provide in global_config.json or AUTH_EMAIL/AUTH_PASSWORD env vars.');
}

const exec = jsonConfig?.execution || {};
const execution: ExecutionConfig = {
  minimum_test_cases: exec.minimum_test_cases ?? 100,
  max_test_cases: exec.max_test_cases ?? 150,
  request_delay: exec.request_delay ?? 0.5,
  cleanup_enabled: exec.cleanup_enabled ?? true,
  cleanup_mode: exec.cleanup_mode === 'full' ? 'full' : 'partial',
};

export const GlobalConfig = {
  baseUrl: apiBaseUrl,
  apiVersion: ENV.API_VERSION,
  auth: {
    primary: primaryUser,
    secondary: userTwo || null,
    loginEndpoint: jsonConfig?.app_bases?.customer?.authentication?.login_endpoint || '/api/clients/auth/login',
  },
  execution: {
    requestDelay: ENV.REQUEST_DELAY_MS,
    maxRetries: ENV.MAX_RETRIES,
    minimumTestCases: execution.minimum_test_cases,
    maxTestCases: execution.max_test_cases,
    cleanupEnabled: execution.cleanup_enabled,
    cleanupMode: execution.cleanup_mode,
  },
  environment: ENV.ENVIRONMENT,
};
