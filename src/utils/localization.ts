/**
 * @file localization.ts
 * @description Localization utilities for bilingual API response validation.
 *
 * Combines language iteration and message assertion into a single module.
 * Used by both static and dynamic specs to verify Arabic/English responses.
 *
 * Business context:
 *   The Gazzer client app serves Arabic and English markets. Every user-facing
 *   API message must be returned in the requested locale (Accept-Language header).
 *   These helpers validate that contract at the test level.
 */

/**
 * Run a callback for each language in the provided list.
 * Returns a record keyed by language code with the callback's result.
 *
 * @param languages - Array of locale codes to iterate ('en', 'ar')
 * @param fn - Async callback executed once per language
 * @returns Record mapping each language to its callback result
 */
export async function runWithLanguages<T>(
  languages: Array<'en' | 'ar'>,
  fn: (language: 'en' | 'ar') => Promise<T>
): Promise<Record<string, T>> {
  const results: Record<string, T> = {};
  for (const lang of languages) {
    results[lang] = await fn(lang);
  }
  return results;
}

/**
 * Assert that a response message matches the expected locale.
 * Arabic is detected by the Unicode Arabic block (\u0600-\u06FF).
 *
 * @param message - The API response message string
 * @param language - Expected language ('en' or 'ar')
 * @throws If the message language doesn't match the expected locale
 */
export function assertLocalizedMessage(message: string, language: 'en' | 'ar') {
  if (!message) {
    throw new Error('[Localization] Missing response message for localization validation.');
  }

  const hasArabic = /[\u0600-\u06FF]/.test(message);

  if (language === 'ar' && !hasArabic) {
    throw new Error(`[Localization] Expected Arabic message, got: ${message}`);
  }
  if (language === 'en' && hasArabic) {
    throw new Error(`[Localization] Expected English message, got Arabic content: ${message}`);
  }
}
