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
      const createRes = await controller.createAddress(payload, { testId: `${testId}-setup`, acceptLanguage: language });
      if (createRes.status() === 400) {
        const cBody = await ResponseHelper.safeJson(createRes);
        const msg = (cBody.message || '').toLowerCase();
        if (msg.includes('20') || msg.includes('limit') || msg.includes('maximum') || msg.includes('delete an existing')) {
          console.warn(`[${testId}] Address limit reached during ${language} iteration — skipping this language.`);
          return;
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

      // Wait for API to persist the default change (eventual consistency)
      await new Promise(resolve => setTimeout(resolve, 300));

      // 3. Verify Single Default (BR-004)
      const verifyRes = await controller.listAddresses({ per_page: '100' }, { testId: `${testId}-verify`, acceptLanguage: language });
      const verifyBody = await ResponseHelper.safeJson(verifyRes);
      expect(verifyBody?.data, 'List response has no data').toBeDefined();

      const validation = BusinessRuleValidator.validateSingleDefaultAddress(verifyBody.data);
      expect(validation.valid).toBe(true);

      const newDefault = verifyBody.data.find((a: any) => a.is_default === true || a.is_default === 1);
      expect(newDefault, 'No default address found after set').toBeTruthy();
      expect(newDefault.id).toBe(created.id);
    });
  });
});
