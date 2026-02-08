/**
 * @file multiUserManager.ts
 * @description Two-user authentication pool with rotation and exhaustion tracking.
 *
 * The Gazzer API enforces rate limits that can block a single test account
 * during high-volume dynamic test runs (100-150 tests). This module maintains
 * two authenticated users (primary + secondary) and provides:
 *
 *   - **AuthHelper**: Static token store shared across all modules
 *   - **MultiUserManager**: Lifecycle manager for login, failover, and exhaustion
 *
 * Failover flow:
 *   1. Rate limit hit → switchUser() rotates to the alternate account
 *   2. Address limit hit → markUserExhausted() + auto-switch
 *   3. Both exhausted → returns false, caller triggers cleanup + resetExhaustion()
 *
 * Authentication uses exponential backoff (up to 5 attempts) with explicit
 * 429 handling to survive API rate limits during the login phase itself.
 *
 * @see {@link ResilientClientAddresses} — consumes this manager for API failover
 * @see {@link StateTracker.handleAddressLimit} — triggers exhaustion flow
 *
 * @module multiUserManager
 */
import { APIRequestContext } from '@playwright/test';
import { AuthController } from '@/api/controllers/AuthController';
import { GlobalConfig } from '@/config/global.config';
import { ResponseHelper } from '@/utils/responseHelper';
import { ExecutionTracker } from '@/utils/executionTracker';

/**
 * User key identifier for the two-user rotation pool.
 * The framework supports exactly two accounts for cross-user failover on rate limits.
 */
export type UserKey = 'user_one' | 'user_two';

/**
 * Static token store for multi-user authentication.
 * Tokens are set during MultiUserManager.initialize() and read by ApiClient
 * and any component that needs the current Bearer token.
 */
export class AuthHelper {
  private static tokens: Record<UserKey, string | null> = {
    user_one: null,
    user_two: null,
  };
  private static activeUser: UserKey = 'user_one';

  static setToken(userKey: UserKey, token: string) {
    this.tokens[userKey] = token;
  }

  static getToken(userKey?: UserKey): string | null {
    const key = userKey || this.activeUser;
    return this.tokens[key];
  }

  static setActiveUser(userKey: UserKey) {
    this.activeUser = userKey;
  }

  static getActiveUser(): UserKey {
    return this.activeUser;
  }
}

/**
 * Manages the two-user authentication pool lifecycle.
 *
 * Handles login for both users, tracks which are authenticated vs. exhausted,
 * and provides switchUser() / markUserExhausted() for failover orchestration.
 */
export class MultiUserManager {
  private authController: AuthController;
  private activeUser: UserKey = 'user_one';
  private authenticatedUsers: Set<UserKey> = new Set();
  /** Users that have hit the address limit (BR-001) and need cleanup before reuse. */
  private exhaustedUsers: Set<UserKey> = new Set();

  constructor(private request: APIRequestContext) {
    this.authController = new AuthController(request);
  }

  getActiveUser(): UserKey {
    return this.activeUser;
  }

  isUserAuthenticated(userKey: UserKey): boolean {
    return this.authenticatedUsers.has(userKey);
  }

  hasAnyAuthentication(): boolean {
    return this.authenticatedUsers.size > 0;
  }

  /**
   * Authenticates both users from global_config.json credentials.
   * Fails fast if neither user can authenticate.
   * Falls back to single-user mode if only one succeeds.
   *
   * @throws {Error} If primary credentials are missing or both logins fail
   */
  async initialize(): Promise<void> {
    if (!GlobalConfig.auth.primary) {
      throw new Error('[MultiUserManager] Missing primary user credentials.');
    }

    const primary = await this.authenticateUser('user_one', GlobalConfig.auth.primary.login, GlobalConfig.auth.primary.password);

    let secondary = false;
    if (GlobalConfig.auth.secondary) {
      secondary = await this.authenticateUser('user_two', GlobalConfig.auth.secondary.login, GlobalConfig.auth.secondary.password);
    } else {
      console.warn('[MultiUserManager] No secondary user credentials configured. Single-user mode.');
    }

    if (!primary && !secondary) {
      throw new Error('[MultiUserManager] Authentication failed for ALL users. Cannot proceed.');
    }

    if (!primary && secondary) {
      this.setActiveUser('user_two');
      console.warn('[MultiUserManager] Primary user failed. Using secondary user only.');
    } else {
      this.setActiveUser('user_one');
    }

    if (primary && !secondary) {
      console.warn('[MultiUserManager] Secondary user failed. Single-user mode — cross-user tests will be skipped.');
    }

    console.log(`[MultiUserManager] Authenticated users: ${[...this.authenticatedUsers].join(', ')}. Active: ${this.activeUser}`);
  }

  /**
   * Authenticates a single user with exponential backoff retry.
   * Checks for cached tokens first to avoid redundant logins.
   * On 429, waits with jitter before retrying (up to 5 attempts).
   *
   * @param userKey - 'user_one' or 'user_two'
   * @param login - Email/phone credential
   * @param password - Password credential
   * @returns true if authentication succeeded, false otherwise
   */
  private async authenticateUser(userKey: UserKey, login: string, password: string): Promise<boolean> {
    // Check for cached token first
    const existingToken = AuthHelper.getToken(userKey);
    if (existingToken) {
      console.log(`[MultiUserManager] Using cached token for ${userKey}.`);
      this.authenticatedUsers.add(userKey);
      return true;
    }

    const maxAttempts = 5; // Increased attempts for stability
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const loginRes = await this.authController.loginWith(login, password);

        // Explicit 429 handling with exponential backoff
        if (loginRes.status() === 429) {
          const delay = Math.round(3000 * Math.pow(2, attempt) + Math.random() * 2000);
          console.warn(`[MultiUserManager] 429 on login for ${userKey}. Retry in ${delay}ms (${attempt + 1}/${maxAttempts})`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }

        if (!loginRes.ok()) {
          const errorText = await loginRes.text();
          console.error(`[MultiUserManager] Login failed for ${userKey}: ${loginRes.status()} - ${errorText.substring(0, 200)}`);
          if (attempt < maxAttempts - 1 && loginRes.status() >= 500) {
            const delay = Math.round(2000 * Math.pow(2, attempt));
            console.warn(`[MultiUserManager] Server error. Retry in ${delay}ms...`);
            await new Promise(r => setTimeout(r, delay));
            continue;
          }
          return false;
        }

        const body = await ResponseHelper.safeJson(loginRes);
        const token = body?.data?.access_token;
        if (!token) {
          console.error(`[MultiUserManager] access_token missing for ${userKey}: ${JSON.stringify(body).substring(0, 200)}`);
          return false;
        }

        AuthHelper.setToken(userKey, token);
        this.authenticatedUsers.add(userKey);
        return true;
      } catch (e) {
        const error = e as Error;
        console.error(`[MultiUserManager] Auth error for ${userKey} (attempt ${attempt + 1}): ${error.message}`);
        if (attempt < maxAttempts - 1) {
          const delay = Math.round(2000 * Math.pow(2, attempt));
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        return false;
      }
    }

    console.error(`[MultiUserManager] All ${maxAttempts} login attempts exhausted for ${userKey}.`);
    return false;
  }

  setActiveUser(userKey: UserKey) {
    this.activeUser = userKey;
    AuthHelper.setActiveUser(userKey);
  }

  /**
   * Marks the current user as "exhausted" (e.g., address limit reached).
   * Automatically attempts to switch to the next available user.
   * Returns true if switch was successful, false if all users are exhausted.
   */
  markUserExhausted(testId: string, reason: string): boolean {
    console.warn(`[MultiUserManager] Marking ${this.activeUser} as exhausted: ${reason}`);
    this.exhaustedUsers.add(this.activeUser);
    
    // Attempt switch
    const nextUser = this.activeUser === 'user_one' ? 'user_two' : 'user_one';
    if (this.canSwitchTo(nextUser)) {
        this.setActiveUser(nextUser);
        ExecutionTracker.recordRateLimit(testId, `Switched to ${nextUser} (Exhaustion: ${reason})`);
        console.log(`[MultiUserManager] Successfully switched to ${nextUser}.`);
        return true;
    }

    console.warn(`[MultiUserManager] Cannot switch to ${nextUser}. It is either unauthenticated or also exhausted.`);
    ExecutionTracker.recordRateLimit(testId, `All users exhausted. Cleanup required.`);
    return false;
  }

  private canSwitchTo(user: UserKey): boolean {
      return this.authenticatedUsers.has(user) && !this.exhaustedUsers.has(user);
  }

  /**
   * Resets exhaustion state for all users (e.g., after DB cleanup).
   */
  resetExhaustion() {
      console.log(`[MultiUserManager] Resetting exhaustion state for all users.`);
      this.exhaustedUsers.clear();
      // Reset to primary if available, otherwise stay on current
      if (this.authenticatedUsers.has('user_one')) {
          this.setActiveUser('user_one');
      }
  }

  /**
   * Rotates to the alternate user if it is both authenticated and not exhausted.
   * Called by {@link ResilientClientAddresses} on RateLimitError.
   * No-op if the target user is unavailable (logs a warning instead).
   *
   * @param reason - Human-readable reason for the switch (logged for traceability)
   * @param testId - Test identifier for execution tracking
   */
  switchUser(reason: string, testId: string) {
    const next = this.activeUser === 'user_one' ? 'user_two' : 'user_one';
    
    // Check if next user is valid (authenticated and NOT exhausted)
    if (!this.authenticatedUsers.has(next)) {
      console.warn(`[MultiUserManager] Cannot switch to ${next} — not authenticated. Staying on ${this.activeUser}.`);
      ExecutionTracker.recordRateLimit(testId, `Cannot switch to ${next} (not authenticated). Reason: ${reason}`);
      return;
    }

    if (this.exhaustedUsers.has(next)) {
        console.warn(`[MultiUserManager] Cannot switch to ${next} — marked as exhausted. Staying on ${this.activeUser}.`);
        ExecutionTracker.recordRateLimit(testId, `Cannot switch to ${next} (exhausted). Reason: ${reason}`);
        return;
    }

    this.setActiveUser(next);
    ExecutionTracker.recordRateLimit(testId, `Switched to ${next} due to ${reason}`);
  }

  /** Records which user (and token source) is being used for a given test. */
  recordUserForTest(testId: string) {
    const source = this.activeUser === 'user_one' ? 'primary' : 'secondary';
    ExecutionTracker.recordUser(testId, this.activeUser, source);
  }
}
