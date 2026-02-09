import { test, expect } from '@playwright/test';
import { StateTracker } from '@/utils/stateTracker';
import { ResponseHelper } from '@/utils/responseHelper';
import { generateUniqueAddress } from '@/api/data/address.valid.payload';
import { BusinessRuleValidator } from '@/api/validators/address.business.validator';
import { setupAuthenticatedContext, findCreatedAddress } from '@/utils/testSetup';
import { PayloadCapture } from '@/utils/payloadCapture';
import { ResilientClientAddresses } from '@/utils/resilientClient';
import { runWithLanguages, assertLocalizedMessage } from '@/utils/localization';
import { ensureAddressCapacity } from '@/utils/capacityHelper';

test.describe('Client Addresses - Set Default', () => {
  let controller: ResilientClientAddresses;
  let originalDefaultId: number | null = null;
  let apiContext: any;
  let tracker: StateTracker;

  test.beforeAll(async ({ playwright }) => {
    const ctx = await setupAuthenticatedContext(playwright);
    apiContext = ctx.apiContext;
    controller = ctx.controller;
    tracker = ctx.tracker;

    // Store original default to restore later
    const listRes = await controller.listAddresses({ per_page: '100' }, { testId: 'ADDR-DEFAULT-setup' });
    const listBody = await ResponseHelper.safeJson(listRes);
    const listData = listBody?.data || [];
    const def = listData.find((a: any) => a.is_default === true || a.is_default === 1);
    if (def) originalDefaultId = def.id;
  });

  test.afterAll(async () => {
    PayloadCapture.getInstance().persistToDisk();
    if (apiContext) {
      // Restore original default
      if (originalDefaultId) {
        console.log(`[ADDR-DEFAULT] Restoring original default address ID: ${originalDefaultId}`);
        await controller.setDefaultAddress({ address_id: originalDefaultId }, { testId: 'ADDR-DEFAULT-restore' });
      }

      await tracker.performLogicalCleanup(apiContext);
      await apiContext.dispose();
    }
  });

  test('ADDR-DEFAULT-001: Set Default Address (Happy Path & BR-004)', async ({}, testInfo) => {
    const testId = 'ADDR-DEFAULT-001';

    await runWithLanguages(['en', 'ar'], async (language) => {
      await ensureAddressCapacity(tracker, apiContext, testId);
      // 1. Create new address
      const payload = generateUniqueAddress(`${testInfo.workerIndex}-${language}`);
      let createRes = await controller.createAddress(payload, { testId: `${testId}-setup`, acceptLanguage: language });
      if (createRes.status() === 400) {
        const cBody = await ResponseHelper.safeJson(createRes);
        const msg = (cBody.message || '').toLowerCase();
        if (msg.includes('20') || msg.includes('limit') || msg.includes('maximum') || msg.includes('delete an existing')) {
          await ensureAddressCapacity(tracker, apiContext, testId);
          createRes = await controller.createAddress(payload, { testId: `${testId}-retry`, acceptLanguage: language });
          if (createRes.status() !== 200) {
            throw new Error(`[INFRA_PRESSURE] Address limit persists after cleanup for ${testId} [${language}]`);
          }
        }
      }
      expect(createRes.status(), 'Create failed').toBe(200);

      const created = await findCreatedAddress(controller as any, 'name', payload.name, `${testId}-list-${language}`, language);
      expect(created, `Created address not found: ${payload.name}`).toBeTruthy();
      tracker.trackCreation(created.id);

      // 2. Set as Default with testId for capture
      const setDefRes = await controller.setDefaultAddress({ address_id: created.id }, { testId, acceptLanguage: language });

      // FAIL FAST: Validate payload was captured
      PayloadCapture.getInstance().validateCapture(testId);

      if (setDefRes.status() !== 200) {
        const errBody = await ResponseHelper.safeJson(setDefRes);
        console.log(`[${testId}] setDefault failed ${setDefRes.status()}:`, JSON.stringify(errBody));
      }
      expect(setDefRes.status()).toBe(200);
      const body = await ResponseHelper.safeJson(setDefRes);
      expect(body.status).toBe('success');
      if (body.message) {
        assertLocalizedMessage(body.message, language);
      }

      // 3. Verify Single Default (BR-004) — polling for eventual consistency
      let verified = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        await new Promise(r => setTimeout(r, 300 * Math.pow(2, attempt)));
        const verifyRes = await controller.listAddresses({ per_page: '100' }, { testId: `${testId}-verify-${attempt}`, acceptLanguage: language });
        const verifyBody = await ResponseHelper.safeJson(verifyRes);
        if (!verifyBody?.data) continue;

        const validation = BusinessRuleValidator.validateSingleDefaultAddress(verifyBody.data);
        const newDefault = verifyBody.data.find((a: any) => (a.is_default === true || a.is_default === 1) && a.id === created.id);
        if (newDefault && validation.valid) {
          verified = true;
          break;
        }
      }
      expect(verified, 'Default address not stabilized after polling').toBe(true);
    });
  });
});
