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
 * hits rate limits. Multi-cycle rotation (3 cycles with progressive cooldowns)
 * maximizes recovery before declaring RATE_LIMIT_EXHAUSTED.
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
import { RequestGovernor } from '@/utils/requestGovernor';

/**
 * Custom error thrown when all retry attempts are exhausted on HTTP 429 (Too Many Requests).
 * Explicitly typed to allow ReportExporter to classify this as INFRA_PRESSURE (not a bug).
 */
export class RateLimitExhaustedError extends Error {
  constructor(message: string) {
    super(`[INFRA_PRESSURE] ${message}`);
    this.name = 'RateLimitExhaustedError';
  }
}

/**
 * Custom error thrown when a single request hits rate limits.
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
 * {@link RateLimitError} and retries with multi-cycle user rotation.
 */
export class ResilientClientAddresses {
  constructor(
    private controller: ClientAddressesController,
    private userManager: MultiUserManager
  ) {}

  /**
   * Executes an API action with multi-cycle rotation failover on rate limiting.
   *
   * Flow per cycle:
   *   1. Record active user, execute action
   *   2. On RateLimitError → switch user → retry on alternate user
   *   3. If alternate also fails → cooldown (5s * 2^cycle) → next cycle
   *   4. After MAX_CYCLES (3) → throw RATE_LIMIT_EXHAUSTED
   *
   * Non-RateLimitError exceptions propagate immediately (no failover for 4xx/5xx).
   */
  private async executeWithFailover<T extends APIResponse>(
    action: () => Promise<T>,
    testId: string
  ): Promise<T> {
    const MAX_CYCLES = 3;
    const COOLDOWN_BASE = 5000;
    const governor = RequestGovernor.getInstance();

    for (let cycle = 0; cycle < MAX_CYCLES; cycle++) {
      this.userManager.recordUserForTest(testId);
      try {
        // Execute through governor (throttling + concurrency cap)
        return await governor.execute(
          () => action(),
          { testId, priority: 'NORMAL', label: 'ResilientClient' }
        );
      } catch (err) {
        if (!(err instanceof RateLimitError)) throw err;

        // Try switching user first (cheaper than waiting)
        const currentUser = this.userManager.getActiveUser();
        this.userManager.switchUser('rate limit', testId);
        const switched = this.userManager.getActiveUser() !== currentUser;

        if (switched) {
          this.userManager.recordUserForTest(testId);
          try {
             // Retry with new user through governor
            return await governor.execute(
              () => action(),
              { testId, priority: 'HIGH', label: 'ResilientClient-Retry' }
            );
          } catch (err2) {
            if (!(err2 instanceof RateLimitError)) throw err2;
            // Alternate user also rate-limited — fall through to cooldown
          }
        }

        // Both users rate-limited — cooldown before next cycle
        if (cycle < MAX_CYCLES - 1) {
          const cooldown = COOLDOWN_BASE * Math.pow(2, cycle);
          ExecutionTracker.recordRateLimit(testId, `Cycle ${cycle + 1}/${MAX_CYCLES} cooldown ${cooldown}ms`);
          
          // Use governor to pause if needed, or just sleep
          await new Promise(r => setTimeout(r, cooldown));
          continue;
        }

        // All cycles exhausted
        ExecutionTracker.recordRateLimit(testId, 'All rotation cycles exhausted');
        const errorMessage = err instanceof Error ? err.message : String(err);
        throw new RateLimitExhaustedError(`Rate limit exhausted for ${testId} after ${MAX_CYCLES} cycles. ${errorMessage}`);
      }
    }
    throw new RateLimitExhaustedError('All rotation cycles failed without explicit error capture.');
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
