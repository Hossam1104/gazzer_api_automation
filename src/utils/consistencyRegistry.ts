/**
 * @file consistencyRegistry.ts
 * @description In-memory registry for tracking created entities (Addresses) to handle
 * eventual consistency issues.
 *
 * Problem: The API might return 200 Created, but a subsequent GET/LIST might not fail
 * immediately due to replication lag.
 *
 * Solution:
 *  - When an entity is created, register it here.
 *  - When verifying, check this registry first.
 *  - Allows "smart retries" for LIST operations if we know an item *should* be there.
 *
 * @module consistencyRegistry
 */

export type EntityType = 'ADDRESS' | 'USER_PREFERENCE';

export class EventualConsistencyRegistry {
  private static instance: EventualConsistencyRegistry;
  private registry: Map<string, Set<string>> = new Map();

  private constructor() {}

  static getInstance(): EventualConsistencyRegistry {
    if (!EventualConsistencyRegistry.instance) {
      EventualConsistencyRegistry.instance = new EventualConsistencyRegistry();
    }
    return EventualConsistencyRegistry.instance;
  }

  /**
   * Registers a newly created entity ID.
   * @param type - The type of entity (e.g., 'ADDRESS')
   * @param id - The unique ID of the entity
   */
  register(type: EntityType, id: string): void {
    if (!this.registry.has(type)) {
      this.registry.set(type, new Set());
    }
    this.registry.get(type)!.add(id);
    console.log(`[ConsistencyRegistry] Registered ${type} ${id} (Expected to exist)`);
  }

  /**
   * Checks if an entity is known to exist, even if the API returns 404.
   * @param type - The type of entity
   * @param id - The unique ID to check
   */
  shouldExist(type: EntityType, id: string): boolean {
    return this.registry.get(type)?.has(id) || false;
  }

  /**
   * Removes an entity from the registry (e.g., after successful DELETE).
   * @param type - The type of entity
   * @param id - The unique ID to remove
   */
  unregister(type: EntityType, id: string): void {
    this.registry.get(type)?.delete(id);
    console.log(`[ConsistencyRegistry] Unregistered ${type} ${id} (Verified deleted)`);
  }

  /**
   * Clears the registry (useful for test suite teardown).
   */
  clear(): void {
    this.registry.clear();
  }
}
