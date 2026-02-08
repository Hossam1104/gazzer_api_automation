/**
 * @file testSetup.ts
 * @description Shared test setup utilities used by all spec files.
 *
 * Provides the primary bootstrap function {@link setupAuthenticatedContext}
 * that every spec's beforeAll hook calls. Ensures consistent auth, state
 * capture, and controller initialization across the entire suite.
 *
 * Also provides {@link findCreatedAddress} as a cross-spec helper for
 * locating a newly created address in the list (since the create API
 * returns empty data in its response).
 *
 * @module testSetup
 */
import type { PlaywrightTestArgs, PlaywrightWorkerArgs } from '@playwright/test';
import { ResponseHelper } from '@/utils/responseHelper';
import { GlobalConfig } from '@/config/global.config';
import { StateTracker } from '@/utils/stateTracker';
import { ClientAddressesController } from '@/api/controllers/ClientAddressesController';
import { MultiUserManager } from '@/utils/multiUserManager';
import { ResilientClientAddresses } from '@/utils/resilientClient';

/**
 * Shared test setup: creates APIRequestContext, authenticates, captures state.
 * Eliminates duplication and ensures consistent auth across all spec files.
 * ROOT-CAUSE-B FIX: Token propagation is guaranteed before any API call.
 */
export async function setupAuthenticatedContext(playwright: PlaywrightWorkerArgs['playwright']) {
  const apiContext = await playwright.request.newContext({
    baseURL: GlobalConfig.baseUrl,
    extraHTTPHeaders: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
  });

  const userManager = new MultiUserManager(apiContext);
  await userManager.initialize();
  console.log(`[Setup] Auth complete. Active user: ${userManager.getActiveUser()}. Both users: ${userManager.hasAnyAuthentication()}.`);

  // Capture state
  const tracker = StateTracker.getInstance();
  await tracker.captureInitialState(apiContext);

  const controller = new ClientAddressesController(apiContext);
  const resilient = new ResilientClientAddresses(controller, userManager);
  return { apiContext, controller: resilient, tracker, userManager };
}

/**
 * Searches the address list for a recently created address by matching a field value.
 * Required because the create API returns an empty data field — the only way to
 * retrieve the new address is to list all addresses and match by name or other field.
 *
 * Supports both {@link ResilientClientAddresses} (2-arg) and raw
 * {@link ClientAddressesController} (3-arg) calling conventions.
 *
 * @param controller - Address controller instance (resilient or raw)
 * @param matchField - Field name to match against (e.g., 'name')
 * @param matchValue - Expected value for the match field
 * @param listTestId - Optional test ID for payload capture
 * @param acceptLanguage - Optional locale for Accept-Language header
 * @returns The matching address object, or null if not found
 */
export async function findCreatedAddress(
  controller: { listAddresses: (...args: any[]) => Promise<any> },
  matchField: string,
  matchValue: string,
  listTestId?: string,
  acceptLanguage?: 'en' | 'ar'
): Promise<any> {
  // Support both resilient (2-arg: queryParams, options) and raw (3-arg: queryParams, testId, options) controllers
  const isResilient = controller.constructor?.name === 'ResilientClientAddresses';
  let listRes: any;
  if (isResilient) {
    listRes = await controller.listAddresses({ per_page: '100' }, { testId: listTestId || `find-${Date.now()}`, acceptLanguage });
  } else {
    listRes = await controller.listAddresses({ per_page: '100' }, listTestId, { acceptLanguage });
  }
  const listBody = await ResponseHelper.safeJson(listRes);

  if (!Array.isArray(listBody?.data)) {
    throw new Error(
      `Failed to list addresses after creation. ` +
      `Response: ${JSON.stringify(listBody).substring(0, 200)}`
    );
  }

  const found = listBody.data.find((addr: any) => addr[matchField] === matchValue);
  return found || null;
}
