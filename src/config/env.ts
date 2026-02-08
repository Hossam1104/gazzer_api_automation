/**
 * @file env.ts
 * @description Environment variable loader with dotenv integration.
 *
 * Reads .env from the project root and exposes typed environment variables.
 * Most variables are optional here because global_config.json provides
 * fallback values via {@link GlobalConfig}. The real validation happens
 * downstream in GlobalConfig and MultiUserManager.
 *
 * Safety: Refuses to run against production domains unless ENVIRONMENT=CI,
 * using hostname-exact matching (not substring) to prevent bypass via
 * crafted domains (e.g., "api.gazzar.com.evil.org").
 *
 * @module env
 */
import dotenv from 'dotenv';
import path from 'path';

// Load .env from root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

/**
 * Retrieves an environment variable with optional required-check and default value.
 *
 * @param key - Environment variable name
 * @param required - If true, throws when the variable is missing
 * @param defaultValue - Fallback value when the variable is absent
 * @returns The resolved variable value
 */
const getEnv = (key: string, required: boolean = false, defaultValue: string = ''): string => {
  const value = process.env[key];
  if (required && !value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value || defaultValue;
};

export const ENV = {
  // BASE_URL, AUTH_EMAIL, AUTH_PASSWORD are not marked 'required' here because
  // global_config.json provides fallback values via GlobalConfig. The real
  // validation happens in GlobalConfig.baseUrl / MultiUserManager.initialize().
  BASE_URL: getEnv('BASE_URL', false),
  API_VERSION: getEnv('API_VERSION', false, 'v1'),
  AUTH_EMAIL: getEnv('AUTH_EMAIL', false),
  AUTH_PASSWORD: getEnv('AUTH_PASSWORD', false),
  REQUEST_DELAY_MS: parseInt(getEnv('REQUEST_DELAY_MS', false, '100'), 10),
  MAX_RETRIES: parseInt(getEnv('MAX_RETRIES', false, '3'), 10),
  ENVIRONMENT: getEnv('ENVIRONMENT', true),
};

// BUG-3 FIX: Use URL hostname comparison instead of .includes() to prevent false positives
// e.g. "api.gazzar.com.evil.org".includes("api.gazzar.com") === true (false positive)
const PROD_DOMAINS = ['api.production.com', 'api.gazzar.com'];

let parsedHostname = '';
if (ENV.BASE_URL) {
  try {
    parsedHostname = new URL(ENV.BASE_URL).hostname;
  } catch {
    throw new Error(`Invalid BASE_URL: "${ENV.BASE_URL}" is not a valid URL.`);
  }
}

const isProduction = parsedHostname ? PROD_DOMAINS.some(d => parsedHostname === d) : false;

if (isProduction && ENV.ENVIRONMENT !== 'CI') {
  throw new Error(`Refusing to run destructive tests on production domain: ${parsedHostname} (Environment: ${ENV.ENVIRONMENT})`);
}
