/**
 * @file entityRegistry.ts
 * @description Polling-based entity confirmation replacing single-shot list lookups.
 *
 * The Gazzer API exhibits eventual consistency: a newly created address may not
 * appear immediately in the list response. This registry provides a polling
 * mechanism with exponential delays to reliably confirm entity creation.
 *
 * Design:
 *   - Attempt 1: Immediate list call (no delay — succeeds most of the time)
 *   - Attempts 2-4: Exponential delays (500ms → 1000ms → 2000ms) between polls
 *   - Each attempt lists with per_page=100 and searches for the match
 *   - On find: returns the entity object
 *   - After max attempts: returns null (caller decides how to handle)
 *
 * @see {@link findCreatedAddress} in testSetup — delegates to this registry
 * @module entityRegistry
 */
import { ResponseHelper } from '@/utils/responseHelper';

interface ConfirmOptions {
  testId: string;
  maxAttempts?: number;
  baseDelayMs?: number;
  acceptLanguage?: 'en' | 'ar';
}

interface ListController {
  listAddresses: (...args: any[]) => Promise<any>;
}

export class EntityRegistry {
  private static instance: EntityRegistry;
  private entities: Map<string, any> = new Map();

  static getInstance(): EntityRegistry {
    if (!EntityRegistry.instance) {
      EntityRegistry.instance = new EntityRegistry();
    }
    return EntityRegistry.instance;
  }

  static reset(): void {
    EntityRegistry.instance = undefined as any;
  }

  /**
   * Polls the list API with exponential delays to find a created entity.
   *
   * @param controller - Controller with listAddresses method (resilient or raw)
   * @param matchField - Field name to match (e.g., 'name')
   * @param matchValue - Expected value for the match field
   * @param options - Polling configuration
   * @returns The matched entity object, or null if not found after all attempts
   */
  async confirmCreation(
    controller: ListController,
    matchField: string,
    matchValue: string,
    options: ConfirmOptions
  ): Promise<any | null> {
    const maxAttempts = options.maxAttempts ?? 4;
    const baseDelay = options.baseDelayMs ?? 500;
    const isResilient = controller.constructor?.name === 'ResilientClientAddresses';

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Delay before retries (not before the first attempt)
      if (attempt > 0) {
        const delay = baseDelay * Math.pow(2, attempt - 1);
        console.log(`[EntityRegistry] Polling attempt ${attempt + 1}/${maxAttempts} after ${delay}ms for ${matchField}=${matchValue}`);
        await new Promise(r => setTimeout(r, delay));
      }

      try {
        let listRes: any;
        if (isResilient) {
          listRes = await controller.listAddresses(
            { per_page: '100' },
            { testId: options.testId, acceptLanguage: options.acceptLanguage }
          );
        } else {
          listRes = await controller.listAddresses(
            { per_page: '100' },
            options.testId,
            { acceptLanguage: options.acceptLanguage }
          );
        }

        const body = await ResponseHelper.safeJson(listRes);
        if (!Array.isArray(body?.data)) {
          console.warn(`[EntityRegistry] Invalid list response on attempt ${attempt + 1}`);
          continue;
        }

        const found = body.data.find((item: any) => item[matchField] === matchValue);
        if (found) {
          const fingerprint = `${matchField}:${matchValue}`;
          this.entities.set(fingerprint, found);
          if (attempt > 0) {
            console.log(`[EntityRegistry] Entity confirmed on attempt ${attempt + 1} (${matchField}=${matchValue})`);
          }
          return found;
        }
      } catch (e) {
        console.warn(`[EntityRegistry] List call failed on attempt ${attempt + 1}: ${(e as Error).message}`);
      }
    }

    console.warn(`[EntityRegistry] Entity not found after ${maxAttempts} attempts (${matchField}=${matchValue})`);
    return null;
  }

  /** Marks an entity as deleted (removes from local cache). */
  markDeleted(fingerprint: string): void {
    this.entities.delete(fingerprint);
  }

  /** Returns a cached entity by fingerprint, or undefined. */
  getCached(fingerprint: string): any | undefined {
    return this.entities.get(fingerprint);
  }
}
