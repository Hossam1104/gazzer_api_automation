import { test, expect } from '@playwright/test';
import { StateTracker } from '@/utils/stateTracker';
import { validateAddressArray } from '@/api/validators/address.schema.validator';
import { BusinessRuleValidator } from '@/api/validators/address.business.validator';
import { ResponseHelper } from '@/utils/responseHelper';
import { GlobalConfig } from '@/config/global.config';
import { setupAuthenticatedContext } from '@/utils/testSetup';
import { PayloadCapture } from '@/utils/payloadCapture';
import { ResilientClientAddresses } from '@/utils/resilientClient';
import { runWithLanguages, assertLocalizedMessage } from '@/utils/localization';

test.describe('Client Addresses - List', () => {
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

  test('ADDR-LIST-001: List all addresses (Happy Path)', async () => {
    const testId = 'ADDR-LIST-001';

    await runWithLanguages(['en', 'ar'], async (language) => {
      const response = await controller.listAddresses(undefined, { testId, acceptLanguage: language });

      // FAIL FAST: Validate payload was captured
      PayloadCapture.getInstance().validateCapture(testId);

      expect(response.status()).toBe(200);
      const body = await ResponseHelper.safeJson(response);

      expect(body.status).toBe('success');
      expect(Array.isArray(body.data)).toBe(true);
      if (body.message) {
        assertLocalizedMessage(body.message, language);
      }

      const validation = validateAddressArray(body.data);
      if (!validation.success) {
        console.error(`[${testId}] Schema errors:`, validation.error);
      }
      expect(validation.success, 'Response data does not match Address Schema').toBe(true);

      expect(body.pagination).toBeDefined();
      expect(typeof body.pagination.current_page).toBe('number');

      // BR-004: Verify at most one default address
      const br004 = BusinessRuleValidator.validateSingleDefaultAddress(body.data);
      if (!br004.valid) {
        console.warn(`[ADDR-LIST-001] BR-004 violation: ${br004.error}`);
      }
    });
  });

  test('ADDR-LIST-002: Unauthorized access (401)', async () => {
    // Create a fresh context WITHOUT auth token
    const unauthContext = await (await import('@playwright/test')).request.newContext({
      baseURL: GlobalConfig.baseUrl,
    });

    try {
      const url = `${GlobalConfig.baseUrl}/api/clients/addresses`;
      for (const language of ['en', 'ar'] as const) {
        const response = await unauthContext.get(url, {
          headers: { 'Accept': 'application/json', 'Accept-Language': language },
        });

        expect(response.status()).toBe(401);
        const body = await ResponseHelper.safeJson(response);
        if (body.message) {
          assertLocalizedMessage(body.message, language);
        }
        const msg = (body.message || '');
        const msgLower = msg.toLowerCase();
        // Accept English auth keywords OR Arabic auth messages
        const hasEnglishAuth = msgLower.includes('token') || msgLower.includes('auth') || msgLower.includes('unauthorized');
        const hasArabicContent = /[\u0600-\u06FF]/.test(msg);
        expect(
          hasEnglishAuth || hasArabicContent,
          `Expected auth error message (en or ar), got: ${msg}`
        ).toBeTruthy();
      }
    } finally {
      await unauthContext.dispose();
    }
  });
});
