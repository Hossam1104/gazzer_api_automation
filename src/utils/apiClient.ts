/**
 * @file apiClient.ts
 * @description HTTP header utility and request/response logger.
 *
 * Provides a centralized method for building authenticated HTTP headers
 * (Bearer token from {@link AuthHelper}) and logging request/response
 * pairs for observability. Used by {@link ClientAddressesController}
 * for every outgoing API call.
 *
 * @module apiClient
 */
import { APIRequestContext, APIResponse, request } from '@playwright/test';
import { AuthHelper } from '@/utils/multiUserManager';
import { GlobalConfig } from '@/config/global.config';

/**
 * Lightweight HTTP utility for header construction and request logging.
 * Does not perform requests itself — that is handled by Playwright's APIRequestContext.
 */
export class ApiClient {

  /**
   * Builds an authenticated header set by injecting the Bearer token
   * for the specified (or currently active) user.
   * Logs a warning if no token is available — the request will proceed
   * without Authorization, which is useful for negative auth tests.
   *
   * @param extraHeaders - Additional headers to merge (e.g., Accept-Language)
   * @param userKey - Optional user key override; defaults to the active user
   * @returns Merged header record with Content-Type, Accept, and Authorization
   */
  static async getAuthenticatedHeaders(extraHeaders?: Record<string, string>, userKey?: string): Promise<Record<string, string>> {
     const token = AuthHelper.getToken(userKey as any);
     const baseHeaders: Record<string, string> = {
       'Content-Type': 'application/json',
       'Accept': 'application/json'
     };
     if (!token) {
         console.warn(`[ApiClient] No auth token available for user '${userKey || 'active'}'. Request will be unauthenticated.`);
         return { ...baseHeaders, ...(extraHeaders || {}) };
     }
     return {
         'Authorization': `Bearer ${token}`,
         ...baseHeaders,
         ...(extraHeaders || {})
     };
  }

  /** Logs outgoing request method and URL (and payload if present). */
  static logRequest(method: string, url: string, data?: any) {
      console.log(`➡️ [REQUEST] ${method} ${url}`);
      if (data) console.log(`   DATA: ${JSON.stringify(data)}`);
  }

  /** Logs response status and URL for observability. */
  static logResponse(status: number, url: string, data?: any) {
      console.log(`⬅️ [RESPONSE] ${status} ${url}`);
  }
}
