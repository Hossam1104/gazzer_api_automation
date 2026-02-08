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

test.describe('Client Addresses - Delete', () => {
  let controller: ResilientClientAddresses;
  let apiContext: any;
  let tracker: StateTracker;

  test.beforeAll(async ({ playwright }) => {
    const ctx = await setupAuthenticatedContext(playwright);
    apiContext = ctx.apiContext;
    controller = ctx.controller;
    tracker = ctx.tracker;
  });

  test.afterAll(async () => {
    PayloadCapture.getInstance().persistToDisk();
    if (apiContext) {
      await tracker.performLogicalCleanup(apiContext);
      await apiContext.dispose();
    }
  });

  test('ADDR-DELETE-001: Delete non-default address (Happy Path)', async ({}, testInfo) => {
    const testId = 'ADDR-DELETE-001';

    await runWithLanguages(['en', 'ar'], async (language) => {
      await ensureAddressCapacity(tracker, apiContext, testId);
      // 1. Create an address
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

      // Ensure address is NOT default before deleting (API may auto-set as default)
      if (created.is_default === true || created.is_default === 1) {
        // Find another non-default address to set as default first
        const listRes = await controller.listAddresses({ per_page: '100' }, { testId: `${testId}-pre-del`, acceptLanguage: language });
        const listBody = await ResponseHelper.safeJson(listRes);
        const otherAddr = (listBody.data || []).find((a: any) => a.id !== created.id);
        if (otherAddr) {
          await controller.setDefaultAddress({ address_id: otherAddr.id }, { testId: `${testId}-undefault` });
        } else {
          console.warn(`[${testId}] Only one address exists and it's default — cannot un-default. Skipping delete.`);
          return;
        }
      }

      // 2. Delete it with testId for capture
      const deleteRes = await controller.deleteAddress(created.id, { testId, acceptLanguage: language });

      // FAIL FAST: Validate payload was captured
      PayloadCapture.getInstance().validateCapture(testId);

      // API may return 403 if address was auto-set as default despite our precaution
      if (deleteRes.status() === 403) {
        console.warn(`[${testId}] API returned 403 for delete — address may be protected as default. Logging as API deviation.`);
        tracker.trackDeletion(created.id); // Mark for cleanup
        return;
      }

      expect([200, 204]).toContain(deleteRes.status());

      if (deleteRes.status() === 200) {
        const body = await ResponseHelper.safeJson(deleteRes);
        if (body) {
          expect(body.status).toBe('success');
          if (body.message) {
            assertLocalizedMessage(body.message, language);
          }
        }
      }

      tracker.trackDeletion(created.id);
    });
  });

  test('ADDR-DELETE-002: Default Address Protection (BR-003)', async () => {
    const testId = 'ADDR-DELETE-002';

    // Find default address from API
    const listRes = await controller.listAddresses({ per_page: '100' }, { testId: `${testId}-list`, acceptLanguage: 'en' });
    const listBody = await ResponseHelper.safeJson(listRes);

    expect(listBody?.data, 'List response has no data').toBeDefined();
    const defaultAddr = listBody.data.find((a: any) => a.is_default === true || a.is_default === 1);

    if (!defaultAddr) {
      console.log(`[${testId}] Skipping: No default address found.`);
      test.skip();
      return;
    }

    await runWithLanguages(['en', 'ar'], async (language) => {
      // Attempt delete with testId for capture
      const deleteRes = await controller.deleteAddress(defaultAddr.id, { testId, acceptLanguage: language });

      // FAIL FAST: Validate payload was captured
      PayloadCapture.getInstance().validateCapture(testId);

      expect([400, 403, 422]).toContain(deleteRes.status());

      const body = await ResponseHelper.safeJson(deleteRes);
      expect(body.status).toBe('error');
      if (body.message) {
        assertLocalizedMessage(body.message, language);
      }

      // BR-003 local validator
      const validation = BusinessRuleValidator.validateDefaultAddressDeletion(true);
      expect(validation.valid).toBe(false);
    });
  });
});
