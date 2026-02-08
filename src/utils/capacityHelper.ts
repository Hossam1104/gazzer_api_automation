/**
 * @file capacityHelper.ts
 * @description Address slot management utilities.
 *
 * Ensures tests that need to create addresses always have at least one available
 * slot, even when accounts approach or hit the 20-address limit (BR-001).
 *
 * Cleanup strategy (three tiers):
 *   1. Delete tracked addresses (created by this test run) — safest
 *   2. Forceful API cleanup — delete up to 5 non-default addresses from the tail
 *   3. Give up — warn that creation tests may fail
 *
 * Default address (BR-003) is never deleted during cleanup.
 *
 * Also provides {@link createAddressWithRetry} for the common pattern:
 *   create → check 400 (limit) → ensureCapacity → retry once.
 *
 * @module capacityHelper
 */
import { APIRequestContext } from '@playwright/test';
import { StateTracker } from '@/utils/stateTracker';
import { ClientAddressesController } from '@/api/controllers/ClientAddressesController';
import { ResponseHelper } from '@/utils/responseHelper';
import { ResilientClientAddresses } from '@/utils/resilientClient';

/**
 * Ensure there is at least 1 address slot available.
 * Strategy:
 *  1. If tracked addresses exist, delete them (logical cleanup).
 *  2. If still at limit, fetch the list and delete the last non-default address via API.
 *  3. On rate-limit during state re-sync, assume still at limit (conservative).
 */
export async function ensureAddressCapacity(
  tracker: StateTracker,
  apiContext: APIRequestContext,
  testId: string
): Promise<void> {
  // When within 3 slots of the limit (17+), force-sync from the live API
  // to avoid acting on stale in-memory counts that diverge after cleanup or external changes.
  if (tracker.getCurrentAddressCount() >= 17) {
    try {
      await tracker.captureInitialState(apiContext);
    } catch (e) {
      console.warn(`[EnsureCapacity] Pre-sync failed for ${testId}: ${(e as Error).message}`);
    }
  }

  if (!tracker.isAddressLimitReached()) {
    return;
  }

  console.log(`[EnsureCapacity] Address limit reached (${tracker.getCurrentAddressCount()}/20). Cleaning up for test ${testId}...`);

  // Step 1: Try cleaning tracked addresses first
  const tracked = tracker.getCreatedAddresses();
  if (tracked.length > 0) {
    await tracker.performLogicalCleanup(apiContext);
    try {
      await tracker.captureInitialState(apiContext);
    } catch (e) {
      console.warn(`[EnsureCapacity] State re-sync failed after tracked cleanup: ${(e as Error).message}. Using stale count.`);
    }
    if (!tracker.isAddressLimitReached()) {
      console.log(`[EnsureCapacity] Freed slots via tracked address cleanup. Now ${tracker.getCurrentAddressCount()}/20.`);
      return;
    }
  }

  // Step 2: Forceful cleanup — delete latest non-default addresses from API list.
  console.log(`[EnsureCapacity] No tracked addresses to clean. Performing forceful cleanup via API...`);
  const controller = new ClientAddressesController(apiContext);
  try {
    const listRes = await controller.listAddresses({ per_page: '100' });
    if (!listRes.ok()) {
      console.warn(`[EnsureCapacity] List failed (${listRes.status()}). Cannot force-clean.`);
      return;
    }
    const body = await ResponseHelper.safeJson(listRes);
    if (!Array.isArray(body.data)) return;

    const defaultId = tracker.getDefaultAddressId();
    // Find non-default addresses to remove (prefer removing from the end).
    // BR-003: Default address is excluded. Reversed so newest addresses are deleted first,
    // preserving older data that may be relied upon by other tests.
    const candidates = body.data
      .filter((a: any) => Number(a.id) !== defaultId && !(a.is_default === true || a.is_default === 1))
      .reverse();

    // Delete up to 5 addresses to free capacity and leave room for multi-step tests
    const toDelete = candidates.slice(0, 5);
    let deleted = 0;
    for (const addr of toDelete) {
      try {
        const delRes = await controller.deleteAddress(addr.id);
        if (delRes.ok()) {
          deleted++;
          console.log(`[EnsureCapacity] Force-deleted address ${addr.id} (${addr.name || 'unnamed'})`);
        } else if (delRes.status() === 429) {
          // Rate limited during cleanup — wait before continuing
          console.warn(`[EnsureCapacity] Rate limited during cleanup. Waiting 3s...`);
          await new Promise(r => setTimeout(r, 3000));
          // Retry this one delete
          const retryRes = await controller.deleteAddress(addr.id);
          if (retryRes.ok()) {
            deleted++;
            console.log(`[EnsureCapacity] Force-deleted address ${addr.id} on retry`);
          }
        } else {
          console.warn(`[EnsureCapacity] Failed to force-delete ${addr.id}: ${delRes.status()}`);
        }
      } catch (e) {
        console.warn(`[EnsureCapacity] Error force-deleting ${addr.id}: ${(e as Error).message}`);
      }
    }
    if (deleted > 0) {
      // Brief cooldown after bulk deletes to avoid immediate 429 on next request
      await new Promise(r => setTimeout(r, 1000));
    }
  } catch (e) {
    console.error(`[EnsureCapacity] Forceful cleanup error: ${(e as Error).message}`);
  }

  // Re-sync state (graceful — don't throw if rate limited)
  try {
    await tracker.captureInitialState(apiContext);
  } catch (e) {
    console.warn(`[EnsureCapacity] State re-sync failed after forceful cleanup: ${(e as Error).message}. Assuming still at limit.`);
  }

  if (tracker.isAddressLimitReached()) {
    console.warn(`[EnsureCapacity] Still at limit after forceful cleanup. Tests requiring creation may fail.`);
  } else {
    console.log(`[EnsureCapacity] Freed slots via forceful cleanup. Now ${tracker.getCurrentAddressCount()}/20.`);
  }
}

/**
 * Create an address with automatic retry on HTTP 400 (address limit).
 * Encapsulates the repeated pattern: create -> check 400 -> ensureCapacity -> wait -> retry.
 * Throws PRECONDITION_SKIP if the address cannot be created after one retry cycle.
 *
 * @param controller - ResilientClientAddresses or compatible controller
 * @param tracker - StateTracker instance for capacity management
 * @param apiContext - Playwright API context for cleanup operations
 * @param payload - Address creation payload
 * @param testId - Test identifier for tracing and logging
 * @returns The successful creation API response (status 200)
 * @throws Error with 'PRECONDITION_SKIP' prefix if creation fails after retry
 */
export async function createAddressWithRetry(
  controller: ResilientClientAddresses,
  tracker: StateTracker,
  apiContext: APIRequestContext,
  payload: any,
  testId: string
): Promise<any> {
  let createRes = await controller.createAddress(payload, { testId: `${testId}-setup` });

  if (createRes.status() === 400) {
    // Address limit likely reached (BR-001) — clean up and retry once
    await ensureAddressCapacity(tracker, apiContext, testId);
    await new Promise(r => setTimeout(r, 1500));
    createRes = await controller.createAddress(payload, { testId: `${testId}-retry` });
    if (createRes.status() === 400) {
      throw new Error(`PRECONDITION_SKIP: Cannot create address for ${testId} — limit reached after retry (BR-001).`);
    }
  }

  return createRes;
}
