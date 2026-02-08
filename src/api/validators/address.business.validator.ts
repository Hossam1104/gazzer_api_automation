/**
 * @file address.business.validator.ts
 * @description Business rule validators for the Client Addresses domain.
 *
 * Each static method validates one business rule and returns a
 * {@link ValidationResult} with a boolean flag and human-readable error.
 *
 * Business rules:
 *   - BR-001: Max 20 addresses per user account
 *   - BR-002: Address name max 50 characters
 *   - BR-003: Default address cannot be deleted
 *   - BR-004: Exactly one default address per user
 *
 * Used by test specs to assert that the API enforces these rules correctly.
 *
 * @module address.business.validator
 */
export interface ValidationResult {
  valid: boolean;
  error: string | null;
}

/**
 * Stateless validators for Gazzer's Client Addresses business rules.
 * Each method is pure — no side effects, no API calls.
 */
export class BusinessRuleValidator {
  /**
   * BR-001: Validates that the user has not exceeded the 20-address limit.
   * @param addressCount - Current number of addresses for the user
   */
  static validateAddressLimit(addressCount: number): ValidationResult {
    const limit = 20;
    return {
      valid: addressCount <= limit,
      error: addressCount > limit ? `Maximum ${limit} addresses allowed per user (Found: ${addressCount})` : null
    };
  }

  /**
   * BR-002: Validates that the address string does not exceed 50 characters.
   * @param address - The address string to validate
   */
  static validateAddressLength(address: string): ValidationResult {
    const limit = 50;
    return {
      valid: address.length <= limit,
      error: address.length > limit ? `Address cannot exceed ${limit} characters (Found: ${address.length})` : null
    };
  }

  /**
   * BR-003: Validates that a default address is not being deleted.
   * @param isDefault - Whether the target address is the current default
   */
  static validateDefaultAddressDeletion(isDefault: boolean): ValidationResult {
    return {
      valid: !isDefault,
      error: isDefault ? 'Default address cannot be deleted' : null
    };
  }

  /**
   * BR-004: Validates that exactly one address is marked as default.
   * @param addresses - Array of address objects to inspect
   */
  static validateSingleDefaultAddress(addresses: any[]): ValidationResult {
    const defaultCount = addresses.filter(addr => addr.is_default === true || addr.is_default === 1).length;
    return {
      valid: defaultCount === 1,
      error: defaultCount !== 1 ? `Expected exactly 1 default address, found ${defaultCount}` : null
    };
  }
}
