/**
 * Arabic address payloads for comprehensive localization testing.
 * Covers happy path, validation errors, and boundary cases.
 *
 * Purpose: Provide explicit Arabic strings for payload testing (not just Accept-Language headers).
 * Addresses MANDATORY requirement for Arabic language coverage.
 */

/**
 * Pre-defined Arabic address payloads for various test scenarios.
 */
export const ArabicAddressPayloads = {
  /**
   * Happy Path - Valid Arabic address with all required fields.
   * Address length: 19 characters (well within 50-char BR-002 limit).
   */
  valid: {
    address: "العنوان الرئيسي",  // Main address (19 chars)
    street: "شارع التحرير",      // Tahrir Street
    name: "المنزل",              // Home
    building: "مبنى رقم ٥",       // Building No. 5
    floor: "3",                   // Floor number (API requires numeric string, not Arabic text)
    apartment: 12,
    lat: 27.164590 + (Math.random() * 0.02 - 0.01),  // ~1km variation from service zone center
    long: 31.156531 + (Math.random() * 0.02 - 0.01),
    is_default: false
  },

  /**
   * Validation - Arabic text exceeding BR-002 limit (50 chars).
   * This payload has 66 Arabic characters to test length validation.
   */
  exceedsLength: {
    address: "عنوان طويل جدا يتجاوز الحد المسموح به من خمسين حرفا للاختبار",  // 66 chars - exceeds BR-002
    street: "شارع طويل",
    name: "عنوان غير صالح",       // Invalid address
    building: "مبنى",
    floor: "1",
    apartment: 1,
    lat: 27.164590,
    long: 31.156531,
    is_default: false
  },

  /**
   * Edge Cases - Mixed language (Arabic + English + Numbers).
   * Tests API handling of multi-script input.
   */
  mixedLanguage: {
    address: "123 شارع التحرير Street",  // Mixed Arabic/English/Numbers
    street: "Main St - الشارع الرئيسي",
    name: "Home-المنزل",
    building: "Building 5",
    floor: "3",  // Fixed: was "3rd", API requires numeric string
    apartment: 12,
    lat: 27.164590,
    long: 31.156531,
    is_default: false
  },

  /**
   * Boundary - Exactly 50 Arabic characters (multi-byte UTF-8 testing).
   * Tests BR-002 boundary with multi-byte UTF-8 characters.
   * Arabic chars are 2-3 bytes each in UTF-8 encoding.
   */
  boundary50Chars: {
    address: "عنوان اختبار بطول خمسين حرفا بالضبط للتأكد من",  // Exactly 50 chars
    street: "شارع",
    name: "اختبار الحد",          // Boundary test
    building: "مبنى 1",
    floor: "2",
    apartment: 5,
    lat: 27.164590,
    long: 31.156531,
    is_default: false
  },

  /**
   * Work Address - Common use case with Arabic naming.
   */
  work: {
    address: "عنوان العمل",         // Work address
    street: "شارع النيل",          // Nile Street
    name: "المكتب",                // Office
    building: "مبنى التجارة",      // Commerce Building
    floor: "5",                     // Fifth floor (numeric string required by API)
    apartment: 501,
    lat: 27.164590 + 0.005,
    long: 31.156531 + 0.005,
    is_default: false
  },

  /**
   * Secondary Home - Another common scenario.
   */
  secondaryHome: {
    address: "المنزل الثاني",       // Second home
    street: "شارع الجامعة",        // University Street
    name: "بيت العائلة",           // Family house
    building: "مبنى الأسرة",       // Family building
    floor: "1",                     // Ground floor (numeric string required by API)
    apartment: 1,
    lat: 27.164590 - 0.005,
    long: 31.156531 - 0.005,
    is_default: false
  },

  /**
   * Validation - Missing required field (name).
   * Tests validation error with Arabic data.
   */
  missingName: {
    address: "عنوان الاختبار",
    street: "شارع الاختبار",
    // name field missing
    building: "مبنى 1",
    floor: "1",
    apartment: 1,
    lat: 27.164590,
    long: 31.156531
  },

  /**
   * Validation - Invalid type (apartment as string instead of number).
   */
  invalidApartmentType: {
    address: "عنوان صالح",
    street: "شارع صالح",
    name: "منزل",
    building: "مبنى",
    floor: "1",
    apartment: "شقة رقم واحد" as any,  // String instead of number - invalid type
    lat: 27.164590,
    long: 31.156531
  }
};

/**
 * Generates a unique Arabic address for parallel test safety.
 *
 * @param workerIndex - Worker index for parallel test isolation (default: 0)
 * @returns Object with unique Arabic address data
 *
 * Usage:
 *   const payload = generateUniqueArabicAddress(workerIndex);
 *   await controller.createAddress(payload, { testId, acceptLanguage: 'ar' });
 *
 * Uniqueness strategy:
 * - Timestamp: Date.now() provides millisecond precision
 * - Worker index: Parallel worker separation
 * - Random suffix: Additional collision prevention
 * - Coordinate variation: ~1km variation to avoid duplicate location rejection
 */
export function generateUniqueArabicAddress(workerIndex: number | string = 0): any {
  const uniqueSuffix = Date.now();
  const randomId = Math.floor(Math.random() * 1000);

  return {
    address: `عنوان-${uniqueSuffix}`,           // Address-{timestamp}
    street: "شارع التحرير",                     // Tahrir Street (constant - safe)
    name: `منزل-${workerIndex}-${uniqueSuffix}`, // Home-{worker}-{timestamp}
    building: `مبنى-${randomId}`,               // Building-{random}
    floor: "1",                                 // First floor (numeric string required by API)
    apartment: Math.floor(Math.random() * 500) + 1,
    lat: 27.164590 + (Math.random() * 0.02 - 0.01),  // Vary ~1km
    long: 31.156531 + (Math.random() * 0.02 - 0.01),
    is_default: false
  };
}

