import { test, expect } from '@playwright/test';
import { StateTracker } from '@/utils/stateTracker';
import { validateAddressSchema } from '@/api/validators/address.schema.validator';
import { BusinessRuleValidator } from '@/api/validators/address.business.validator';
import { ResponseHelper } from '@/utils/responseHelper';
import { generateUniqueAddress } from '@/api/data/address.valid.payload';
import { InvalidAddressPayloads } from '@/api/data/address.invalid.payload';
import { setupAuthenticatedContext, findCreatedAddress } from '@/utils/testSetup';
import { PayloadCapture } from '@/utils/payloadCapture';
import { ResilientClientAddresses } from '@/utils/resilientClient';
import { runWithLanguages, assertLocalizedMessage } from '@/utils/localization';
import { MultiUserManager } from '@/utils/multiUserManager';
import { ExecutionTracker } from '@/utils/executionTracker';

test.describe('Client Addresses - Create', () => {
  let controller: ResilientClientAddresses;
  let apiContext: any;
  let tracker: StateTracker;
  let userManager: MultiUserManager;

  test.beforeAll(async ({ playwright }) => {
    const ctx = await setupAuthenticatedContext(playwright);
    apiContext = ctx.apiContext;
    controller = ctx.controller;
    tracker = ctx.tracker;
    userManager = ctx.userManager;
  });

  test.afterAll(async () => {
    PayloadCapture.getInstance().persistToDisk();
    if (apiContext) {
      await tracker.performLogicalCleanup(apiContext);
      await apiContext.dispose();
    }
  });

  test('ADDR-CREATE-001: Create valid address (Happy Path)', async ({}, testInfo) => {
    const testId = 'ADDR-CREATE-001';

    await runWithLanguages(['en', 'ar'], async (language) => {
      ExecutionTracker.recordLanguage(testId, language);
      // NOTE: ensureAddressCapacity is no longer sufficient as it doesn't switch users.
      // We rely on the retry logic below.
      
      const payload = generateUniqueAddress(`${testInfo.workerIndex}-${language}`);
      let response;

      // Retry loop to handle Address Limit via User Rotation/Cleanup
      for (let attempt = 0; attempt < 2; attempt++) {
          response = await controller.createAddress(payload, { testId, acceptLanguage: language });
          
          if (response.status() === 400 || response.status() === 422) {
               // Check if it's the specific limit error
               const body = await ResponseHelper.safeJson(response);
               const msg = (body.message || '').toLowerCase();
               if (msg.includes('20') || msg.includes('limit') || msg.includes('maximum') || msg.includes('delete an existing')) {
                   console.warn(`[${testId}] Address limit reached (Attempt ${attempt + 1}). Triggering handling via StateTracker...`);
                   await tracker.handleAddressLimit(userManager, apiContext, testId);
                   continue; // Retry the create with new user/cleaned state
               }
          }
          break; // If success or other error, break loop
      }

      if (!response) throw new Error('No response after retry loop');

      // FAIL FAST: Validate payload was captured
      PayloadCapture.getInstance().validateCapture(testId);

      if (response.status() !== 200) {
        const errBody = await ResponseHelper.safeJson(response);
        console.log(`[${testId}] Create failed ${response.status()}:`, JSON.stringify(errBody));
      }
      
      expect(response.status(), `Create returned ${response.status()}`).toBe(200);
      const body = await ResponseHelper.safeJson(response);
      expect(body.status).toBe('success');
      if (body.message) {
        assertLocalizedMessage(body.message, language);
      }

      // API returns empty data[] on create — must fetch by name
      const createdAddress = await findCreatedAddress(controller as any, 'name', payload.name, `${testId}-list-${language}`, language);

      // BUG-6 FIX: Guard against null with descriptive failure
      expect(createdAddress, `Created address not found by name="${payload.name}"`).toBeTruthy();
      expect(createdAddress.id, 'Created address has no id').toBeDefined();

      tracker.trackCreation(createdAddress.id);

      // Schema validation
      const validation = validateAddressSchema(createdAddress);
      if (!validation.success) {
        console.log(`[${testId}] Schema errors:`, JSON.stringify(validation.error, null, 2));
      }
      expect(validation.success, 'Schema validation failed').toBe(true);

      // BR-002: Length check
      const lenCheck = BusinessRuleValidator.validateAddressLength(createdAddress.address);
      expect(lenCheck.valid, lenCheck.error || '').toBe(true);
    });
  });

  test('ADDR-CREATE-002: Validation Error - Address > 50 chars (BR-002)', async () => {
    const testId = 'ADDR-CREATE-002';
    // No need to ensure capacity for validation error checks usually, 
    // but if API checks limit before validation, we might fail falsely. 
    // However, validation usually comes first.
    
    await runWithLanguages(['en', 'ar'], async (language) => {
      ExecutionTracker.recordLanguage(testId, language);
      
      const payload = {
        ...InvalidAddressPayloads.exceedsLength,
        building: 'B1',
        floor: '1',
        apartment: 1,
        lat: 27.164590,
        long: 31.156531,
      };

      const response = await controller.createAddress(payload, { testId, acceptLanguage: language });

      // FAIL FAST: Validate payload was captured
      PayloadCapture.getInstance().validateCapture(testId);

      // BR-002: Client must reject > 50 chars. 200 is a FAILURE.
      if (response.status() === 200) {
        throw new Error(`[${testId}] API FAILED TO ENFORCE BR-002: Accepted address > 50 chars (HTTP 200)`);
      }

      expect([400, 422]).toContain(response.status());

      const body = await ResponseHelper.safeJson(response);
      expect(body.status).toBe('error');
      if (body.message) {
        assertLocalizedMessage(body.message, language);
      }

      if (body.data?.address) {
        const errMsg = (body.data.address[0] || '').toLowerCase();
        expect(errMsg).toMatch(/(length|max|character|long)/);
      } else {
        console.log(`[${testId}] Error body:`, JSON.stringify(body));
      }
    });
  });

  test('ADDR-CREATE-003: Business Limit - Max 20 Addresses (BR-001)', async ({}, testInfo) => {
    const testId = 'ADDR-CREATE-003';

    // ── Phase 1: Fill the account to 20 addresses (precondition for BR-001) ──
    // Seed loop: create addresses until tracker reports 20.
    // Handles rate-limiting, duplicate-location, and transient API errors.
    const MAX_SEED_FAILURES = 5;
    let consecutiveFailures = 0;

    while (tracker.getCurrentAddressCount() < 20 && consecutiveFailures < MAX_SEED_FAILURES) {
      const seedPayload = generateUniqueAddress(`${testInfo.workerIndex}-seed-${Date.now()}`);
      const seedRes = await controller.createAddress(seedPayload, { testId: `${testId}-seed`, acceptLanguage: 'en' });
      
      if (seedRes.status() !== 200) {
        consecutiveFailures++;
        // Refresh tracker from live API — count might be out of sync
        await tracker.captureInitialState(apiContext);
        if (tracker.getCurrentAddressCount() >= 20) break;
        console.warn(`[${testId}] Seed creation failed (attempt ${consecutiveFailures}/${MAX_SEED_FAILURES}). ` +
          `Tracker: ${tracker.getCurrentAddressCount()}/20, HTTP ${seedRes.status()}`);
        continue;
      }
      
      consecutiveFailures = 0;
      const created = await findCreatedAddress(controller as any, 'name', seedPayload.name, `${testId}-seed-list`, 'en');
      if (created?.id) {
        tracker.trackCreation(created.id);
      } else {
        // Address created but not found in list — refresh tracker
        await tracker.captureInitialState(apiContext);
        if (tracker.getCurrentAddressCount() >= 20) break;
      }
    }

    // ── Phase 2: Verify precondition — MUST be at 20 to test BR-001 ──
    // Fresh list call to confirm actual count (don't trust in-memory tracker alone)
    const verifyRes = await controller.listAddresses({ per_page: '100' }, { testId: `${testId}-verify` });
    const verifyBody = await ResponseHelper.safeJson(verifyRes);
    const actualCount = Array.isArray(verifyBody?.data) ? verifyBody.data.length : 0;

    if (actualCount < 20) {
      throw new Error(
        `PRECONDITION_SKIP: BR-001 test requires 20 addresses but only ${actualCount} exist. ` +
        `Seed loop exhausted after ${consecutiveFailures} consecutive failures. ` +
        `Cannot reliably test address limit rejection.`
      );
    }

    // ── Phase 3: Assert BR-001 rejection — the 21st address MUST fail ──
    await runWithLanguages(['en', 'ar'], async (language) => {
      ExecutionTracker.recordLanguage(testId, language);
      const payload = generateUniqueAddress(`${testInfo.workerIndex}-${language}`);
      const response = await controller.createAddress(payload, { testId, acceptLanguage: language });

      // FAIL FAST: Validate payload was captured
      PayloadCapture.getInstance().validateCapture(testId);

      // BR-001: API MUST reject with 400 or 422 when at the 20-address limit.
      if (response.status() === 200) {
        throw new Error(`[${testId}] API FAILED TO ENFORCE BR-001: Accepted 21st address (HTTP 200) - Limit not enforced`);
      }

      expect([400, 422]).toContain(response.status());
      const body = await ResponseHelper.safeJson(response);
      expect(body.status).toBe('error');
      if (body.message) {
        assertLocalizedMessage(body.message, language);
      }
      const msg = (body.message || '').toLowerCase();
      expect(msg.includes('limit') || msg.includes('maximum') || msg.includes('20') || msg.includes('delete an existing')).toBeTruthy();
    });
  });
});
