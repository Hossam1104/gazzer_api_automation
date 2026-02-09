/**
 * @file failureClassifier.ts
 * @description Maps precondition failures to a structured taxonomy instead of
 * allowing test skips. Every test must execute and produce a classified result.
 *
 * Categories:
 *   - BUSINESS_RULE_VIOLATION: API fails to enforce documented business rules
 *   - SECURITY_DEFECT: API accepts malicious input or leaks data
 *   - LOCALIZATION_DEFECT: Missing/incorrect localized responses
 *   - DATA_INTEGRITY_DEFECT: Entity not found, stale data, inconsistent state
 *   - INFRA_PRESSURE: Rate limiting, network issues, resource exhaustion
 *
 * @module failureClassifier
 */

export type FailureCategory =
  | 'BUSINESS_RULE_VIOLATION'
  | 'SECURITY_DEFECT'
  | 'LOCALIZATION_DEFECT'
  | 'DATA_INTEGRITY_DEFECT'
  | 'INFRA_PRESSURE';

/**
 * Classifies a precondition failure message into a structured category.
 * Used by the zero-skip policy to convert PRECONDITION_SKIP into a typed failure.
 */
export function classifyPreconditionFailure(message: string): FailureCategory {
  const lower = message.toLowerCase();

  if (lower.includes('rate limit') || lower.includes('rate_limit') ||
      lower.includes('429') || lower.includes('throttl') ||
      lower.includes('secondary user not authenticated') ||
      lower.includes('all users exhausted') ||
      lower.includes('timeout') || lower.includes('econnrefused') ||
      lower.includes('health check failed')) {
    return 'INFRA_PRESSURE';
  }

  if (lower.includes('address limit') || lower.includes('br-001') ||
      lower.includes('limit reached after retry')) {
    return 'INFRA_PRESSURE';
  }

  if (lower.includes('could not find') || lower.includes('not found') ||
      lower.includes('entity not found') || lower.includes('stale') ||
      lower.includes('invalid response structure')) {
    return 'DATA_INTEGRITY_DEFECT';
  }

  if (lower.includes('403') || lower.includes('cross-user') ||
      lower.includes('unauthorized') || lower.includes('injection') ||
      lower.includes('xss') || lower.includes('unsanitized')) {
    return 'SECURITY_DEFECT';
  }

  if (lower.includes('locali') || lower.includes('arabic') ||
      lower.includes('accept-language') || lower.includes('i18n')) {
    return 'LOCALIZATION_DEFECT';
  }

  if (lower.includes('br-002') || lower.includes('br-003') || lower.includes('br-004') ||
      lower.includes('business rule') || lower.includes('default address')) {
    return 'BUSINESS_RULE_VIOLATION';
  }

  return 'INFRA_PRESSURE';
}
