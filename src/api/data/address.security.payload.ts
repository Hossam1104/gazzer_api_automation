/**
 * Security test payloads for injection, XSS, and data integrity validation.
 * Comprehensive coverage per MANDATORY requirement #3: Security Tests.
 *
 * Purpose: Test API resilience against common security vulnerabilities:
 * - SQL Injection
 * - Cross-Site Scripting (XSS)
 * - Path Traversal
 * - Command Injection
 * - NoSQL Injection
 * - LDAP Injection
 * - Format String attacks
 *
 * Expected API Behavior:
 * - Reject malicious payloads (400/422)
 * - Sanitize input before storage
 * - NEVER return 500 (indicates vulnerability)
 * - No data corruption or code execution
 */

/**
 * Comprehensive security payload collections.
 */
export const SecurityPayloads = {
  /**
   * SQL Injection Test Payloads (8 variants)
   *
   * Tests: SQL injection attacks targeting database queries.
   * Expected: API should reject OR sanitize, never execute SQL.
   * Risk: Database exposure, data leakage, data loss.
   */
  sqlInjection: [
    {
      name: "SQL: OR 1=1 (Authentication Bypass)",
      value: "' OR 1=1 --",
      description: "Classic authentication bypass attempt"
    },
    {
      name: "SQL: DROP TABLE (Data Destruction)",
      value: "'; DROP TABLE client_addresses; --",
      description: "Attempt to delete database table"
    },
    {
      name: "SQL: UNION SELECT (Data Extraction)",
      value: "' UNION SELECT id, login, password FROM users --",
      description: "Attempt to extract user credentials"
    },
    {
      name: "SQL: Stacked Query (Multiple Commands)",
      value: "'; DELETE FROM client_addresses WHERE 1=1; --",
      description: "Execute multiple SQL statements"
    },
    {
      name: "SQL: Time-based Blind Injection",
      value: "' OR SLEEP(5) --",
      description: "Detect SQL injection via response delay"
    },
    {
      name: "SQL: Boolean Blind Injection",
      value: "' AND 1=1 --",
      description: "Boolean-based blind SQL injection"
    },
    {
      name: "SQL: Comment Injection",
      value: "admin'--",
      description: "Bypass authentication using SQL comments"
    },
    {
      name: "SQL: Hex Encoding Bypass",
      value: "0x61646d696e",
      description: "Hex-encoded 'admin' to bypass filters"
    }
  ],

  /**
   * Cross-Site Scripting (XSS) Test Payloads (10 variants)
   *
   * Tests: XSS attacks that could execute in user browsers.
   * Expected: API should sanitize/escape HTML, never store executable scripts.
   * Risk: Session hijacking, data theft, malware distribution.
   */
  xss: [
    {
      name: "XSS: Basic Script Tag",
      value: "<script>alert(1)</script>",
      description: "Classic script tag injection"
    },
    {
      name: "XSS: IMG Tag with onerror",
      value: "<img src=x onerror=alert(1)>",
      description: "Image tag event handler exploit"
    },
    {
      name: "XSS: SVG with onload",
      value: "\"><svg/onload=alert(1)>",
      description: "SVG element with onload event"
    },
    {
      name: "XSS: Body Tag with onload",
      value: "<body onload=alert(1)>",
      description: "Body tag event handler"
    },
    {
      name: "XSS: IMG without Quotes",
      value: "<img src=x onerror=alert(document.cookie)>",
      description: "Cookie theft attempt"
    },
    {
      name: "XSS: JavaScript Protocol",
      value: "javascript:alert(1)",
      description: "JavaScript protocol in href/src"
    },
    {
      name: "XSS: Data URL",
      value: "data:text/html,<script>alert(1)</script>",
      description: "Data URL with embedded script"
    },
    {
      name: "XSS: Input Event Handler",
      value: "<input onfocus=alert(1) autofocus>",
      description: "Auto-focus event trigger"
    },
    {
      name: "XSS: HTML Entity Encoded",
      value: "&#60;script&#62;alert(1)&#60;/script&#62;",
      description: "HTML entity encoding bypass attempt"
    },
    {
      name: "XSS: Iframe Injection",
      value: "<iframe src=javascript:alert(1)></iframe>",
      description: "Iframe-based JavaScript execution"
    }
  ],

  /**
   * Path Traversal Test Payloads (4 variants)
   *
   * Tests: Directory traversal attacks targeting file system.
   * Expected: API should reject or sanitize path components.
   * Risk: Unauthorized file access, configuration exposure.
   */
  pathTraversal: [
    {
      name: "Path: Parent Directory (Unix)",
      value: "../../etc/passwd",
      description: "Unix password file access attempt"
    },
    {
      name: "Path: Windows System Files",
      value: "..\\..\\windows\\system32\\config\\sam",
      description: "Windows SAM database access attempt"
    },
    {
      name: "Path: URL Encoded Traversal",
      value: "..%2F..%2Fetc%2Fpasswd",
      description: "URL-encoded directory traversal"
    },
    {
      name: "Path: Double URL Encoding",
      value: "..%252F..%252Fetc%252Fpasswd",
      description: "Double-encoded traversal bypass"
    }
  ],

  /**
   * Command Injection Test Payloads (4 variants)
   *
   * Tests: OS command injection attacks.
   * Expected: API should never execute shell commands from user input.
   * Risk: Server compromise, data breach, system takeover.
   */
  commandInjection: [
    {
      name: "CMD: Pipe Command",
      value: "| ls -la",
      description: "Pipe to list directory contents"
    },
    {
      name: "CMD: Semicolon Chain",
      value: "; cat /etc/passwd",
      description: "Chained command to read password file"
    },
    {
      name: "CMD: Backtick Substitution",
      value: "`whoami`",
      description: "Backtick command substitution"
    },
    {
      name: "CMD: Dollar Substitution",
      value: "$(whoami)",
      description: "Dollar sign command substitution"
    }
  ],

  /**
   * NoSQL Injection Test Payloads (3 variants)
   *
   * Tests: NoSQL injection attacks (MongoDB, etc.).
   * Expected: API should validate/sanitize query parameters.
   * Risk: Database bypass, data leakage.
   */
  noSqlInjection: [
    {
      name: "NoSQL: $ne (Not Equal)",
      value: '{"$ne": null}',
      description: "Not-equal operator bypass"
    },
    {
      name: "NoSQL: $gt (Greater Than)",
      value: '{"$gt": ""}',
      description: "Greater-than operator bypass"
    },
    {
      name: "NoSQL: $regex (Pattern Match)",
      value: '{"$regex": ".*"}',
      description: "Regex wildcard match all"
    }
  ],

  /**
   * LDAP Injection Test Payloads (3 variants)
   *
   * Tests: LDAP injection attacks.
   * Expected: API should sanitize LDAP queries.
   * Risk: Authentication bypass, data exposure.
   */
  ldapInjection: [
    {
      name: "LDAP: Wildcard Match",
      value: "*",
      description: "Wildcard to match all entries"
    },
    {
      name: "LDAP: Bypass Authentication",
      value: "*)(&",
      description: "LDAP filter bypass"
    },
    {
      name: "LDAP: OR Condition",
      value: "admin)(|(password=*)",
      description: "OR condition to bypass password check"
    }
  ],

  /**
   * Format String Attack Payloads (3 variants)
   *
   * Tests: Format string vulnerabilities.
   * Expected: API should not interpret format specifiers.
   * Risk: Memory disclosure, application crash.
   */
  formatString: [
    {
      name: "Format: %s String Specifier",
      value: "%s%s%s%s%s%s%s%s%s%s",
      description: "Multiple string format specifiers"
    },
    {
      name: "Format: %x Hex Dump",
      value: "%x%x%x%x%x%x%x%x%x%x",
      description: "Hex memory dump attempt"
    },
    {
      name: "Format: %n Write Specifier",
      value: "%n%n%n%n%n%n%n%n%n%n",
      description: "Memory write format specifier"
    }
  ],

  /**
   * Additional Edge Cases for Security Testing
   */
  edgeCases: [
    {
      name: "Null Byte Injection",
      value: "address\x00.jpg",
      description: "Null byte to bypass file extension checks"
    },
    {
      name: "CRLF Injection",
      value: "Address\r\nInjected-Header: malicious",
      description: "HTTP header injection via CRLF"
    },
    {
      name: "Unicode Overlong Encoding",
      value: "\xC0\xAF",
      description: "Overlong UTF-8 encoding of '/'"
    },
    {
      name: "XML Entity Expansion (Billion Laughs)",
      value: "<!DOCTYPE foo [<!ENTITY lol \"lol\">]><foo>&lol;&lol;&lol;</foo>",
      description: "XML entity expansion DoS"
    }
  ]
};

/**
 * Creates a security test payload by injecting attack string into a specified field.
 *
 * @param attackValue - The attack string (e.g., "' OR 1=1 --")
 * @param targetField - Field to inject into (default: 'address')
 * @returns Complete address payload with injected attack value
 *
 * Usage:
 *   const payload = createSecurityTestPayload("' OR 1=1 --", 'address');
 *   const res = await controller.createAddress(payload, { testId });
 *   // Validate: API rejects OR sanitizes (200/400/422), never 500
 */
export function createSecurityTestPayload(
  attackValue: string,
  targetField: 'address' | 'street' | 'name' | 'building' | 'floor' = 'address'
): any {
  const basePayload: any = {
    address: "Safe Address",
    street: "Main St",
    name: "SecTest",
    building: "B1",
    floor: "1",
    apartment: 1,
    lat: 27.164590,
    long: 31.156531,
    is_default: false
  };

  // Inject attack value into target field
  basePayload[targetField] = attackValue;

  return basePayload;
}

/**
 * Creates a batch of security test payloads for a specific attack category.
 *
 * @param category - Attack category ('sql', 'xss', 'path', 'cmd', 'nosql', 'ldap', 'format')
 * @param targetField - Field to inject into
 * @returns Array of payloads with attack strings injected
 *
 * Usage:
 *   const payloads = createSecurityTestBatch('xss', 'name');
 *   for (const payload of payloads) {
 *     const res = await controller.createAddress(payload.data, { testId });
 *     // Test each XSS variant
 *   }
 */
export function createSecurityTestBatch(
  category: 'sql' | 'xss' | 'path' | 'cmd' | 'nosql' | 'ldap' | 'format',
  targetField: 'address' | 'street' | 'name' | 'building' | 'floor' = 'address'
): Array<{ name: string; description: string; payload: any }> {
  const categoryMap: Record<string, any[]> = {
    sql: SecurityPayloads.sqlInjection,
    xss: SecurityPayloads.xss,
    path: SecurityPayloads.pathTraversal,
    cmd: SecurityPayloads.commandInjection,
    nosql: SecurityPayloads.noSqlInjection,
    ldap: SecurityPayloads.ldapInjection,
    format: SecurityPayloads.formatString
  };

  const attacks = categoryMap[category] || [];

  return attacks.map(attack => ({
    name: attack.name,
    description: attack.description,
    payload: createSecurityTestPayload(attack.value, targetField)
  }));
}

/**
 * Security test validation helper.
 * Checks if API response indicates a potential vulnerability.
 *
 * @param status - HTTP response status code
 * @param testId - Test identifier for logging
 * @param attackType - Type of attack being tested
 * @returns Object with vulnerability assessment
 *
 * Vulnerability Indicators:
 * - 500: Server error (possible vulnerability)
 * - 200 with unexpected data: Input not sanitized
 * - 400/422: Expected (proper validation)
 */
export function assessSecurityResponse(
  status: number,
  testId: string,
  attackType: string
): { isVulnerable: boolean; severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'NONE'; message: string } {
  // 500 = Server error, likely vulnerability
  if (status === 500) {
    return {
      isVulnerable: true,
      severity: 'CRITICAL',
      message: `[${testId}] CONFIRMED API BUG: ${attackType} caused 500 error - potential vulnerability`
    };
  }

  // 200 = Accepted (needs further validation - check if sanitized)
  if (status === 200) {
    return {
      isVulnerable: false,  // Assume safe unless data integrity check fails
      severity: 'MEDIUM',
      message: `[${testId}] ${attackType} accepted (200) - verify sanitization`
    };
  }

  // 400/422 = Validation error (expected, good)
  if (status === 400 || status === 422) {
    return {
      isVulnerable: false,
      severity: 'NONE',
      message: `[${testId}] ${attackType} rejected correctly (${status})`
    };
  }

  // 403 = WAF/Security layer blocked (acceptable)
  if (status === 403) {
    return {
      isVulnerable: false,
      severity: 'NONE',
      message: `[${testId}] ${attackType} blocked by security layer (403)`
    };
  }

  // Other status codes - unexpected
  return {
    isVulnerable: false,
    severity: 'MEDIUM',
    message: `[${testId}] ${attackType} returned unexpected status ${status}`
  };
}

/**
 * Checks if stored data contains unsanitized attack payload.
 *
 * @param fieldValue - Value retrieved from API
 * @param originalAttack - Original attack string
 * @returns True if attack payload detected unsanitized
 *
 * Usage:
 *   const created = await findCreatedAddress(controller, 'name', payload.name);
 *   if (isUnsanitized(created.address, xssPayload)) {
 *     console.error('CONFIRMED API BUG: XSS stored unsanitized');
 *   }
 */
export function isUnsanitized(fieldValue: string, originalAttack: string): boolean {
  if (!fieldValue || !originalAttack) return false;

  // Check for common attack patterns that should be sanitized
  const dangerousPatterns = [
    /<script>/i,                // Script tags
    /onerror=/i,                // Event handlers
    /javascript:/i,             // JavaScript protocol
    /\.\.\//,                   // Path traversal
    /';.*--/,                   // SQL comment
    /union\s+select/i,          // SQL UNION
    /\|\s*ls/,                  // Command pipe
    /\$\(/,                     // Command substitution
  ];

  return dangerousPatterns.some(pattern => pattern.test(fieldValue));
}

/**
 * Complete test scenario builder for security testing.
 *
 * @param category - Attack category
 * @param targetField - Field to test
 * @returns Array of test scenarios with expected behavior
 *
 * Usage:
 *   const scenarios = buildSecurityScenarios('xss', 'name');
 *   for (const scenario of scenarios) {
 *     // Execute test
 *     // Validate using scenario.expectedStatuses
 *     // Check sanitization using scenario.checkSanitization
 *   }
 */
export function buildSecurityScenarios(
  category: 'sql' | 'xss' | 'path' | 'cmd' | 'nosql',
  targetField: 'address' | 'street' | 'name' | 'building' | 'floor' = 'address'
): Array<{
  id: string;
  name: string;
  description: string;
  payload: any;
  attackValue: string;
  expectedStatuses: number[];
  checkSanitization: boolean;
  severity: 'CRITICAL' | 'HIGH';
}> {
  const batch = createSecurityTestBatch(category, targetField);

  return batch.map((item, index) => ({
    id: `SEC-${category.toUpperCase()}-${index + 1}`,
    name: item.name,
    description: item.description,
    payload: item.payload,
    attackValue: item.payload[targetField],
    expectedStatuses: [200, 400, 422],  // Never 500
    checkSanitization: true,
    severity: (category === 'sql' || category === 'xss' || category === 'cmd') ? 'CRITICAL' : 'HIGH'
  }));
}
