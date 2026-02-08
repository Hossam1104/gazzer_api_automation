/**
 * @file ClientAddressesController.ts
 * @description Low-level CRUD controller for the Client Addresses API.
 *
 * All methods include:
 *   - Exponential-backoff retry for transient errors (429, 5xx)
 *   - Mandatory payload capture via {@link PayloadCapture}
 *   - Rate-limit escalation via {@link RateLimitError} (consumed by {@link ResilientClientAddresses})
 *
 * Business rules exercised:
 *   - BR-001: POST /addresses — create (subject to 20-address limit)
 *   - BR-002: POST /addresses, POST /addresses/update/{id} — 50-char name validation
 *   - BR-003: DELETE /addresses/{id} — default address protection
 *   - BR-004: POST /addresses/set-default — single default constraint
 *
 * @module ClientAddressesController
 */
import { APIRequestContext, APIResponse } from '@playwright/test';
import { GlobalConfig } from '@/config/global.config';
import { ApiClient } from '@/utils/apiClient';
import { PayloadCapture } from '@/utils/payloadCapture';
import { RateLimitError } from '@/utils/resilientClient';

type RequestOptions = {
  acceptLanguage?: 'en' | 'ar';
  userKey?: 'user_one' | 'user_two';
  headers?: Record<string, string>;
};

export class ClientAddressesController {
  constructor(private request: APIRequestContext) {}

  /**
   * Universal retry logic for 5xx and network errors.
   * NEVER retries 4xx or business logic failures.
   * Payload capture is mandatory for every request.
   */
  private async retryingRequest(
    action: () => Promise<APIResponse>,
    context: string,
    logMeta: { method: string; url: string; data?: any; testId?: string; language?: string; userKey?: 'user_one' | 'user_two' }
  ): Promise<APIResponse> {
    let attempts = 0;
    const maxRetries = GlobalConfig.execution.maxRetries;
    let lastResponse: APIResponse | null = null;

    while (attempts <= maxRetries) {
      try {
        ApiClient.logRequest(logMeta.method, logMeta.url, logMeta.data);
        const response = await action();
        lastResponse = response;
        ApiClient.logResponse(response.status(), response.url());

        // Capture payload if testId provided (mandatory for report generation)
        if (logMeta.testId) {
          try {
            await PayloadCapture.getInstance().capture(
              logMeta.testId,
              logMeta.method,
              logMeta.url,
              logMeta.data || null,
              response,
              { language: logMeta.language, userKey: logMeta.userKey }
            );
          } catch (captureError) {
            console.error(`[PayloadCapture] Failed for ${logMeta.testId}:`, captureError);
          }
        }

        // Retry only transient responses; 429 escalates to RateLimitError after max retries.
        if ([429, 502, 503, 504].includes(response.status())) {
          if (attempts < maxRetries) {
            const delay = Math.round(1000 * Math.pow(2, attempts) + Math.random() * 500);
            console.warn(`[${context}] Got ${response.status()}. Retrying in ${delay}ms... (Attempt ${attempts + 1}/${maxRetries})`);
            attempts++;
            await new Promise(r => setTimeout(r, delay));
            continue;
          }
          if (response.status() === 429) {
            throw new RateLimitError(
              `[RATE_LIMIT] ${context} exhausted retries for ${logMeta.url}`,
              response.status(),
              logMeta.url
            );
          }
        }

        return response;

      } catch (error) {
        if (attempts < maxRetries) {
          const delay = Math.round(1000 * Math.pow(2, attempts) + Math.random() * 500);
          console.warn(`[${context}] Network error: ${error}. Retrying in ${delay}ms... (Attempt ${attempts + 1}/${maxRetries})`);
          attempts++;
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw error;
      }
    }
    throw new Error(`[${context}] Failed after ${maxRetries} retries.`);
  }

  /**
   * Builds HTTP headers with auth token and optional Accept-Language.
   * Delegates to {@link ApiClient.getAuthenticatedHeaders}.
   */
  private buildHeaders(options?: RequestOptions): Promise<Record<string, string>> {
    const extra: Record<string, string> = { ...(options?.headers || {}) };
    if (options?.acceptLanguage) {
      extra['Accept-Language'] = options.acceptLanguage;
    }
    return ApiClient.getAuthenticatedHeaders(extra, options?.userKey);
  }

  /** GET /api/clients/addresses — Lists all addresses with optional query params (pagination). */
  async listAddresses(queryParams?: Record<string, string>, testId?: string, options?: RequestOptions): Promise<APIResponse> {
    const url = `${GlobalConfig.baseUrl}/api/clients/addresses`;
    return this.retryingRequest(
      async () => {
        const headers = await this.buildHeaders(options);
        return this.request.get(url, { headers, params: queryParams });
      },
      'listAddresses',
      { method: 'GET', url, data: queryParams, testId, language: options?.acceptLanguage, userKey: options?.userKey }
    );
  }

  /** POST /api/clients/addresses — Creates a new address. Subject to BR-001 (20 limit) and BR-002 (50 chars). */
  async createAddress(payload: any, testId?: string, options?: RequestOptions): Promise<APIResponse> {
    const url = `${GlobalConfig.baseUrl}/api/clients/addresses`;
    return this.retryingRequest(
      async () => {
        const headers = await this.buildHeaders(options);
        return this.request.post(url, { headers, data: payload });
      },
      'createAddress',
      { method: 'POST', url, data: payload, testId, language: options?.acceptLanguage, userKey: options?.userKey }
    );
  }

  /** POST /api/clients/addresses/update/{id} — Updates an existing address. Subject to BR-002. */
  async updateAddress(id: number | string, payload: any, testId?: string, options?: RequestOptions): Promise<APIResponse> {
    const url = `${GlobalConfig.baseUrl}/api/clients/addresses/update/${id}`;
    return this.retryingRequest(
      async () => {
        const headers = await this.buildHeaders(options);
        return this.request.post(url, { headers, data: payload });
      },
      'updateAddress',
      { method: 'POST', url, data: payload, testId, language: options?.acceptLanguage, userKey: options?.userKey }
    );
  }

  /** DELETE /api/clients/addresses/{id} — Deletes an address. Subject to BR-003 (default protection). */
  async deleteAddress(id: number | string, testId?: string, options?: RequestOptions): Promise<APIResponse> {
    const url = `${GlobalConfig.baseUrl}/api/clients/addresses/${id}`;
    return this.retryingRequest(
      async () => {
        const headers = await this.buildHeaders(options);
        return this.request.delete(url, { headers });
      },
      'deleteAddress',
      { method: 'DELETE', url, testId, language: options?.acceptLanguage, userKey: options?.userKey }
    );
  }

  /** POST /api/clients/addresses/set-default — Sets the default address. Enforces BR-004 (single default). */
  async setDefaultAddress(payload: { address_id: number | string }, testId?: string, options?: RequestOptions): Promise<APIResponse> {
    const url = `${GlobalConfig.baseUrl}/api/clients/addresses/set-default`;
    return this.retryingRequest(
      async () => {
        const headers = await this.buildHeaders(options);
        return this.request.post(url, { headers, data: payload });
      },
      'setDefaultAddress',
      { method: 'POST', url, data: payload, testId, language: options?.acceptLanguage, userKey: options?.userKey }
    );
  }
}
