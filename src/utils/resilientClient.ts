/**
 * @file resilientClient.ts
 * @description Resilient wrapper around {@link ClientAddressesController} with
 * automatic cross-user failover on HTTP 429 (rate limiting).
 *
 * Architecture:
 *   ResilientClientAddresses -> executeWithFailover() -> ClientAddressesController
 *                                     |
 *                               RateLimitError caught
 *                                     |
 *                               MultiUserManager.switchUser()
 *                                     |
 *                               Retry with alternate user
 *
 * The two-user rotation pool allows the suite to continue when one account
 * hits rate limits. If both users are exhausted, a RATE_LIMIT_EXHAUSTED error
 * is thrown and the test is classified as ENVIRONMENT_CONSTRAINT in the report.
 *
 * @see {@link RateLimitError} — custom error that triggers failover
 * @see {@link MultiUserManager} — manages the two-user pool
 *
 * @module resilientClient
 */
import { APIResponse } from '@playwright/test';
import { ClientAddressesController } from '@/api/controllers/ClientAddressesController';
import { MultiUserManager } from '@/utils/multiUserManager';
import { ExecutionTracker } from '@/utils/executionTracker';

/**
 * Custom error thrown when all retry attempts are exhausted on HTTP 429 (Too Many Requests).
 * Caught by ResilientClientAddresses to trigger cross-user failover.
 */
export class RateLimitError extends Error {
  status: number;
  endpoint: string;
  constructor(message: string, status: number, endpoint: string) {
    super(message);
    this.name = 'RateLimitError';
    this.status = status;
    this.endpoint = endpoint;
  }
}

type RequestOptions = {
  acceptLanguage?: 'en' | 'ar';
  testId: string;
};

/**
 * Wraps {@link ClientAddressesController} with transparent rate-limit failover.
 * All CRUD methods delegate through {@link executeWithFailover} which catches
 * {@link RateLimitError} and retries once on the alternate user.
 */
export class ResilientClientAddresses {
  constructor(
    private controller: ClientAddressesController,
    private userManager: MultiUserManager
  ) {}

  /**
   * Executes an API action with single-retry failover on rate limiting.
   *
   * Flow:
   *   1. Record active user for the test
   *   2. Execute action
   *   3. On RateLimitError → switch user → retry once
   *   4. On second RateLimitError → record exhaustion → throw RATE_LIMIT_EXHAUSTED
   *
   * Non-RateLimitError exceptions propagate immediately (no failover for 4xx/5xx).
   *
   * @param action - The API call to execute
   * @param testId - Test identifier for tracing and user recording
   * @returns The API response from either the primary or failover attempt
   */
  private async executeWithFailover<T extends APIResponse>(
    action: () => Promise<T>,
    testId: string
  ): Promise<T> {
    this.userManager.recordUserForTest(testId);
    try {
      return await action();
    } catch (err) {
      // Only RateLimitError triggers user failover; all other errors bubble up.
      if (err instanceof RateLimitError) {
        this.userManager.switchUser('rate limit', testId);
        this.userManager.recordUserForTest(testId);
        try {
          return await action();
        } catch (err2) {
          if (err2 instanceof RateLimitError) {
            ExecutionTracker.recordRateLimit(testId, 'Rate limit exhausted for both users');
            throw new Error(`[RATE_LIMIT_EXHAUSTED] ${err2.message}`);
          }
          throw err2;
        }
      }
      throw err;
    }
  }

  /** Lists addresses with failover support. Records Accept-Language if provided. */
  async listAddresses(queryParams: Record<string, string> | undefined, options: RequestOptions): Promise<APIResponse> {
    if (options.acceptLanguage) {
      ExecutionTracker.recordLanguage(options.testId, options.acceptLanguage);
    }
    return this.executeWithFailover(
      () => this.controller.listAddresses(queryParams, options.testId, { acceptLanguage: options.acceptLanguage, userKey: this.userManager.getActiveUser() }),
      options.testId
    );
  }

  /** Creates an address with failover support. Subject to BR-001 (20 address limit). */
  async createAddress(payload: any, options: RequestOptions): Promise<APIResponse> {
    if (options.acceptLanguage) {
      ExecutionTracker.recordLanguage(options.testId, options.acceptLanguage);
    }
    return this.executeWithFailover(
      () => this.controller.createAddress(payload, options.testId, { acceptLanguage: options.acceptLanguage, userKey: this.userManager.getActiveUser() }),
      options.testId
    );
  }

  /** Updates an address with failover support. Subject to BR-002 (50 char max). */
  async updateAddress(id: number | string, payload: any, options: RequestOptions): Promise<APIResponse> {
    if (options.acceptLanguage) {
      ExecutionTracker.recordLanguage(options.testId, options.acceptLanguage);
    }
    return this.executeWithFailover(
      () => this.controller.updateAddress(id, payload, options.testId, { acceptLanguage: options.acceptLanguage, userKey: this.userManager.getActiveUser() }),
      options.testId
    );
  }

  /** Deletes an address with failover support. Subject to BR-003 (default protection). */
  async deleteAddress(id: number | string, options: RequestOptions): Promise<APIResponse> {
    if (options.acceptLanguage) {
      ExecutionTracker.recordLanguage(options.testId, options.acceptLanguage);
    }
    return this.executeWithFailover(
      () => this.controller.deleteAddress(id, options.testId, { acceptLanguage: options.acceptLanguage, userKey: this.userManager.getActiveUser() }),
      options.testId
    );
  }

  /** Sets the default address with failover support. Enforces BR-004 (single default). */
  async setDefaultAddress(payload: { address_id: number | string }, options: RequestOptions): Promise<APIResponse> {
    if (options.acceptLanguage) {
      ExecutionTracker.recordLanguage(options.testId, options.acceptLanguage);
    }
    return this.executeWithFailover(
      () => this.controller.setDefaultAddress(payload, options.testId, { acceptLanguage: options.acceptLanguage, userKey: this.userManager.getActiveUser() }),
      options.testId
    );
  }
}
