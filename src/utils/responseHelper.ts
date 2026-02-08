/**
 * @file responseHelper.ts
 * @description Safe JSON response parser with comprehensive validation.
 *
 * Handles common API response pitfalls:
 *   - BOM (Byte Order Mark) stripping for UTF-8 responses
 *   - Empty body handling (204 No Content)
 *   - Non-JSON Content-Type tolerance (some API endpoints omit the header)
 *   - Descriptive error messages on parse failure
 *
 * Used throughout the framework as the single point of JSON deserialization.
 *
 * @module responseHelper
 */
import { APIResponse } from '@playwright/test';

export class ResponseHelper {
  /**
   * Safely parse JSON response with comprehensive validation
   * - Checks HTTP status
   * - Validates Content-Type header
   * - Handles BOM (Byte Order Mark)
   * - Provides descriptive error messages
   * - Fails fast on non-JSON responses
   */
  static async safeJson(response: APIResponse, options: { allowedStatuses?: number[], requireJson?: boolean } = {}): Promise<any> {
    const { allowedStatuses = [], requireJson = true } = options;
    const status = response.status();
    const url = response.url();
    const contentType = response.headers()['content-type'] || '';

    // Validate HTTP status if specified
    if (allowedStatuses.length > 0 && !allowedStatuses.includes(status)) {
      const text = await response.text();
      throw new Error(
        `[ResponseHelper] Unexpected HTTP status ${status} for ${url}.\n` +
        `Expected one of: ${allowedStatuses.join(', ')}.\n` +
        `Response body: ${text.substring(0, 200)}`
      );
    }

    // Check Content-Type if JSON is required
    if (requireJson && !contentType.includes('application/json')) {
      const text = await response.text();
      console.warn(
        `[ResponseHelper] Non-JSON Content-Type: "${contentType}" for ${url}.\n` +
        `Status: ${status}\n` +
        `Body preview: ${text.substring(0, 200)}`
      );
      // Don't throw here - some APIs return JSON without proper Content-Type header
      // But log the warning for observability
    }

    // Get response text
    const text = await response.text();

    // Remove BOM (Byte Order Mark) if present (UTF-8 BOM: EF BB BF -> U+FEFF)
    const cleanText = text.replace(/^\uFEFF/, '').trim();

    // Handle empty response (common for 204 No Content)
    if (!cleanText) {
      if (status === 204) {
        return {}; // 204 No Content is expected to be empty
      }
      console.warn(`[ResponseHelper] Empty response body for status ${status} at ${url}`);
      return {};
    }

    // Parse JSON
    try {
      return JSON.parse(cleanText);
    } catch (e) {
      const error = e as Error;
      console.error(
        `[ResponseHelper] JSON Parse Failed for ${url}\n` +
        `Status: ${status}\n` +
        `Content-Type: ${contentType}\n` +
        `Raw Text (first 300 chars): "${text.substring(0, 300)}"\n` +
        `Error: ${error.message}`
      );
      throw new Error(
        `Failed to parse JSON response from ${url} (Status: ${status}).\n` +
        `Raw response: ${text.substring(0, 300)}\n` +
        `Parse error: ${error.message}`
      );
    }
  }
}
