/**
 * @file stateTracker.ts
 * @description Singleton tracker for address lifecycle state during test execution.
 *
 * Maintains a real-time view of:
 *   - Current address count per authenticated user
 *   - The default address ID (for BR-003 deletion protection)
 *   - Set of addresses created by the current test run (for safe cleanup)
 *   - Client ID mapping per user key
 *
 * State is initially captured from the live API (GET /addresses) and then
 * incrementally updated via trackCreation() / trackDeletion() calls.
 *
 * When the address limit is reached (BR-001: 20 addresses), the tracker
 * orchestrates user switching and logical cleanup to keep tests running.
 *
 * Business rules:
 *   - BR-001: 20 address limit — triggers handleAddressLimit() flow
 *   - BR-003: Default address protection — skipped during cleanup
 *   - BR-004: Single default constraint — tracked via defaultAddressId
 *
 * @see {@link MultiUserManager} for user switching on exhaustion
 * @see {@link ensureAddressCapacity} in capacityHelper for pre-test slot guarantees
 *
 * @module stateTracker
 */
import { APIRequestContext } from '@playwright/test';
import { ClientAddressesController } from '@/api/controllers/ClientAddressesController';
import { ResponseHelper } from '@/utils/responseHelper';
import { GlobalConfig } from '@/config/global.config';
import { AuthHelper } from '@/utils/multiUserManager';
import { MultiUserManager } from '@/utils/multiUserManager';
import { ExecutionTracker } from '@/utils/executionTracker';

export class StateTracker {
  private static instance: StateTracker;
  private addressCount: number = 0;
  private defaultAddressId: number | null = null;
  private clientIds: Map<string, number> = new Map();
  // Tracks addresses created by this test run only (used for safe cleanup).
  // BUG-4 FIX: All IDs normalized to number via Number() before insertion
  private createdAddresses: Set<number> = new Set();

  static getInstance(): StateTracker {
    if (!StateTracker.instance) {
      StateTracker.instance = new StateTracker();
    }
    return StateTracker.instance;
  }

  /** Reset singleton for fresh test runs (each spec file gets its own worker) */
  static resetInstance(): void {
    StateTracker.instance = new StateTracker();
  }

  /**
   * Fetches the live address list from the API and initializes all tracked state.
   * Retries up to 4 times with exponential backoff on 429/5xx.
   * On persistent rate limiting, conservatively assumes the account is at limit
   * (BR-001: 20 addresses) to prevent blind creation attempts.
   *
   * @param request - Playwright API request context with auth headers
   * @throws {Error} If all retry attempts fail (FATAL — tests cannot proceed)
   */
  async captureInitialState(request: APIRequestContext): Promise<void> {
    const controller = new ClientAddressesController(request);
    console.log('[StateTracker] Capturing initial state...');

    const maxAttempts = 4;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await controller.listAddresses({ per_page: '100' });

        // Retry on 429 with exponential backoff
        if (response.status() === 429) {
          if (attempt < maxAttempts - 1) {
            const delay = Math.round(3000 * Math.pow(2, attempt) + Math.random() * 2000);
            console.warn(`[StateTracker] 429 on state capture. Retry in ${delay}ms (${attempt + 1}/${maxAttempts})`);
            await new Promise(r => setTimeout(r, delay));
            continue;
          }
          console.error('[StateTracker] Rate limit persists after retries. Setting conservative defaults.');
          this.addressCount = 20; // Assume at limit to prevent blind creation
          return;
        }

        // Retry on 5xx
        if (response.status() >= 500) {
          if (attempt < maxAttempts - 1) {
            const delay = Math.round(2000 * Math.pow(2, attempt));
            console.warn(`[StateTracker] Server error ${response.status()}. Retry in ${delay}ms...`);
            await new Promise(r => setTimeout(r, delay));
            continue;
          }
        }

        if (!response.ok()) {
          const status = response.status();
          const text = await response.text();
          throw new Error(
            `StateTracker ABORT: GET /addresses returned ${status}. ` +
            `Response: ${text.substring(0, 300)}`
          );
        }

        const body = await ResponseHelper.safeJson(response);

        // API uses status: "success" not success: true
        const isSuccess = body.success === true || body.status === 'success';
        if (!isSuccess || !Array.isArray(body.data)) {
          throw new Error(
            `StateTracker ABORT: Invalid response structure. ` +
            `Got: ${JSON.stringify(body).substring(0, 200)}`
          );
        }

        const addresses = body.data;
        this.addressCount = addresses.length;

        const defaultAddr = addresses.find((a: any) => a.is_default === true || a.is_default === 1);
        // BUG-4 FIX: Normalize ID to number
        this.defaultAddressId = defaultAddr ? Number(defaultAddr.id) : null;

        const inferredClientId = addresses[0]?.client_id;
        if (inferredClientId !== undefined && inferredClientId !== null) {
          const currentUser = AuthHelper.getActiveUser();
          this.clientIds.set(currentUser, Number(inferredClientId));
          console.log(`[StateTracker] Client ID for ${currentUser}: ${inferredClientId}`);
        }

        console.log(
          `[StateTracker] Initial State: ${this.addressCount} addresses, ` +
          `Default ID: ${this.defaultAddressId ?? 'None'}, ` +
          `${this.addressCount >= 20 ? 'AT LIMIT' : `${20 - this.addressCount} slots available`}`
        );

        return; // Success
      } catch (e) {
        const error = e as Error;
        if (attempt < maxAttempts - 1) {
          const delay = Math.round(2000 * Math.pow(2, attempt));
          console.warn(`[StateTracker] Attempt ${attempt + 1} failed: ${error.message}. Retry in ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        console.error('[StateTracker] All attempts failed.', error.message);
        throw new Error(
          `StateTracker FATAL: ${error.message}\n` +
          `Action required: Fix authentication/API access before running tests.`
        );
      }
    }
  }

  /**
   * Records a newly created address in the tracker.
   * BUG-4 FIX: All IDs are normalized to number via Number() to prevent
   * type-mismatch issues when comparing against default address ID (BR-003).
   *
   * @param addressId - ID returned by the create API (may be string or number)
   */
  trackCreation(addressId: number | string): void {
    const normalizedId = Number(addressId);
    if (isNaN(normalizedId)) {
      console.error(`[StateTracker] Cannot track non-numeric ID: ${addressId}`);
      return;
    }
    this.createdAddresses.add(normalizedId);
    this.addressCount++;
    console.log(`[StateTracker] Tracked ID: ${normalizedId}. Count: ${this.addressCount}`);
  }

  /**
   * Removes a deleted address from the tracker and decrements the count.
   * Only affects addresses that were created by this test run (tracked set).
   *
   * @param addressId - ID of the deleted address
   */
  trackDeletion(addressId: number | string): void {
    const normalizedId = Number(addressId);
    if (this.createdAddresses.has(normalizedId)) {
      this.createdAddresses.delete(normalizedId);
      this.addressCount = Math.max(0, this.addressCount - 1);
      console.log(`[StateTracker] Untracked ID: ${normalizedId}. Count: ${this.addressCount}`);
    }
  }

  /** Returns the current tracked address count for the active user. */
  getCurrentAddressCount(): number {
    return this.addressCount;
  }

  /** Checks if the account has reached the 20-address limit (BR-001). */
  isAddressLimitReached(): boolean {
    return this.addressCount >= 20;
  }

  /** Returns all address IDs created during this test run (safe to delete on cleanup). */
  getCreatedAddresses(): number[] {
    return Array.from(this.createdAddresses);
  }

  /** Returns the current default address ID, or null if none found. Used for BR-003 protection. */
  getDefaultAddressId(): number | null {
    return this.defaultAddressId;
  }

  /**
   * Returns the client_id for a given user key (inferred from the address list response).
   * Falls back to the active user if no key is specified.
   */
  getClientId(userKey?: string): number | null {
    const key = userKey || AuthHelper.getActiveUser();
    return this.clientIds.get(key) || null;
  }

  /**
   * Handles the scenario where address limit (20) is reached.
   * 1. Marks current user exhausted & attempts switch.
   * 2. If all exhausted -> Triggers full cleanup for ALL known client IDs.
   * 3. Resets exhaustion state.
   */
  async handleAddressLimit(
    userManager: MultiUserManager,
    request: APIRequestContext,
    testId: string
  ): Promise<void> {
    console.warn(`[StateTracker] Handling Address Limit for test ${testId}.`);
    
    // 1. Mark current user as exhausted and try to switch
    const switched = userManager.markUserExhausted(testId, 'Address Limit Reached');
    
    if (switched) {
        console.log(`[StateTracker] Switched user. Refreshing state...`);
        await this.captureInitialState(request);
        return;
    }

    // 2. All users exhausted — perform logical cleanup (delete non-default addresses via API)
    console.warn(`[StateTracker] All users exhausted. Performing logical cleanup via API.`);
    ExecutionTracker.recordCleanup(testId, 'Logical Cleanup (All Users Exhausted)');

    await this.performLogicalCleanup(request);

    // 3. Reset exhaustion and refresh
    userManager.resetExhaustion();
    await this.captureInitialState(request);
  }

  /**
   * Deletes all tracked (test-run-created) addresses via the API.
   * Skips the default address to honour BR-003 (default address protection).
   * BUG-4 FIX: Compares normalized numeric IDs to avoid type mismatches.
   *
   * @param request - Playwright API request context
   */
  async performLogicalCleanup(request: APIRequestContext): Promise<void> {
    const controller = new ClientAddressesController(request);
    console.log(`[StateTracker] Cleaning up ${this.createdAddresses.size} tracked items...`);

    for (const addressId of this.createdAddresses) {
      // BUG-4 FIX: Compare normalized IDs
      if (Number(addressId) === Number(this.defaultAddressId)) {
        console.warn(`[StateTracker] Skipping default ID: ${addressId}`);
        continue;
      }

      try {
        const response = await controller.deleteAddress(addressId);
        if (response.status() === 200 || response.status() === 204) {
          console.log(`[StateTracker] Cleaned up ID: ${addressId}`);
        } else {
          console.warn(`[StateTracker] Cleanup failed for ID: ${addressId} (${response.status()})`);
        }
      } catch (e) {
        console.error(`[StateTracker] Error cleaning ID: ${addressId}`, e);
      }
    }
    this.createdAddresses.clear();
  }
}
