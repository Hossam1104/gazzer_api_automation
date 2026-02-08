/**
 * @file address.valid.payload.ts
 * @description Factory for valid address payloads used in positive test cases.
 *
 * {@link ValidAddressPayload} is a static baseline with known-good values.
 * {@link generateUniqueAddress} produces collision-free variants by appending
 * a timestamp + worker index + random suffix. All generated values respect
 * BR-002 (50-char max) via substring truncation.
 *
 * Coordinates are kept within the Gazzer service zone (~1km variation from
 * a known-valid point) to avoid geo-validation rejections.
 *
 * @module address.valid.payload
 */

/** Static baseline payload with known-valid field values. */
export const ValidAddressPayload = {
  address: "Valid St",
  street: "Main Street",
  name: "Home",
  building: "Building A",
  floor: "1",
  apartment: 101,  // Must be integer
  lat: 27.164590,  // Using coordinates from existing address (within service zone)
  long: 31.156531,
  is_default: false
};

/**
 * Generates a unique address payload safe for parallel test execution.
 * Each field is truncated to stay within BR-002 limits.
 *
 * @param workerIndex - Playwright worker index (for multi-worker uniqueness)
 * @returns A complete address payload with unique name, address, and building
 */
export const generateUniqueAddress = (workerIndex: number | string = 0) => {
    const uniqueSuffix = `${Date.now()}-${workerIndex}-${Math.floor(Math.random() * 1000)}`;
    return {
        ...ValidAddressPayload,
        name: `AutoAddress-${uniqueSuffix}`,
        address: `Addr-${uniqueSuffix}`.substring(0, 50), // Ensure < 50 chars even with suffix
        building: `Bldg-${uniqueSuffix}`.substring(0, 50),
        floor: String(Math.floor(Math.random() * 20) + 1), // Random floor 1-20
        apartment: Math.floor(Math.random() * 500) + 1,  // Integer apartment number 1-500
        lat: 27.164590 + (Math.random() * 0.02 - 0.01), // Moderate variation: ~1km range, stays in service zone
        long: 31.156531 + (Math.random() * 0.02 - 0.01)
    };
};
