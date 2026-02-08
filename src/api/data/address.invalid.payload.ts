/**
 * @file address.invalid.payload.ts
 * @description Invalid address payloads for negative / boundary test cases.
 *
 * Used to verify that the API correctly rejects malformed requests:
 *   - exceedsLength: Violates BR-002 (51 chars, limit is 50)
 *   - missingName: Missing required 'name' field
 *
 * @module address.invalid.payload
 */
export const InvalidAddressPayloads = {
  /** BR-002 violation: address string is 51 characters (limit is 50). */
  exceedsLength: {
    address: "A".repeat(51), // 51 chars
    street: "Test St",
    name: "TooLong"
  },
  /** Missing required 'name' field — should trigger validation error. */
  missingName: {
      address: "Valid St",
      street: "Test St"
      // name missing
  },
  // Add others as per spec if needed
};
