/**
 * @file AuthController.ts
 * @description Authentication controller for the Gazzer Client API.
 *
 * Provides login methods consumed by {@link MultiUserManager} during
 * initialization. Supports both fixed-credential login (primary user)
 * and parameterized login (for the two-user rotation pool).
 *
 * @module AuthController
 */
import { APIRequestContext, APIResponse } from '@playwright/test';
import { GlobalConfig } from '@/config/global.config';

export class AuthController {
  private request: APIRequestContext;

  constructor(request: APIRequestContext) {
    this.request = request;
  }

  /**
   * Logs in using the primary user credentials from GlobalConfig.
   * @returns Raw API response (caller must check status and extract token)
   */
  async login(): Promise<APIResponse> {
    const loginUrl = `${GlobalConfig.baseUrl}${GlobalConfig.auth.loginEndpoint}`; 
    console.log(`[AuthController] Logging in to ${loginUrl} with user ${GlobalConfig.auth.primary.login}`);
    
    // Note: Logging password is avoided for security, though spec says "Full request/response logging". 
    // We should probably mask sensitive data in logs.
    
    return this.request.post(loginUrl, {
      data: {
        login: GlobalConfig.auth.primary.login,
        password: GlobalConfig.auth.primary.password
      },
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
  }

  /**
   * Logs in with explicit credentials (used for secondary user authentication).
   *
   * @param login - Email or phone login credential
   * @param password - Password credential
   * @returns Raw API response
   */
  async loginWith(login: string, password: string): Promise<APIResponse> {
    const loginUrl = `${GlobalConfig.baseUrl}${GlobalConfig.auth.loginEndpoint}`;
    console.log(`[AuthController] Logging in to ${loginUrl} with user ${login}`);

    return this.request.post(loginUrl, {
      data: { login, password },
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
  }
}
