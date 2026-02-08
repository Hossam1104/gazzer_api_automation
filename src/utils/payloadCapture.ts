/**
 * @file payloadCapture.ts
 * @description Cross-process payload persistence for API test automation.
 *
 * Every API request/response pair is captured and stored both in-memory (per-worker)
 * and on disk (for cross-process report generation). The report pipeline reads
 * disk payloads to reconstruct full request/response data for the HTML report.
 *
 * Architecture:
 *   - In-memory Map<testId, CapturedPayload[]> for same-process access
 *   - Disk persistence to test-results/payloads/ using PID-stamped filenames
 *     to avoid write collisions in multi-worker mode
 *   - Static loadFromDisk() merges all worker files for the reporter process
 *
 * Capture is MANDATORY: disabling it or failing to capture will cause the
 * report pipeline to emit warnings for tests with missing payload data.
 *
 * @see {@link ReportExporter} — consumes captured payloads during report generation
 * @see {@link ClientAddressesController.retryingRequest} — calls capture() after every API request
 *
 * @module payloadCapture
 */
import fs from 'fs';
import path from 'path';

export interface CapturedPayload {
  request_payload: any | string;
  response_payload: any | string;
  response_status_code: number;
  endpoint: string;
  method: string;
  timestamp: string;
  test_id?: string;
  language?: string;
  user_key?: string;
}

/**
 * Directory for cross-process payload persistence.
 * Each worker writes to its own PID-stamped file to avoid collisions.
 */
const PAYLOADS_DIR = path.resolve(__dirname, '../../test-results/payloads');

/**
 * Singleton payload capture manager.
 * Thread-safe within a single worker process (Playwright uses separate processes per worker).
 */
export class PayloadCapture {
  private static instance: PayloadCapture;
  private payloads: Map<string, CapturedPayload[]> = new Map();
  private enabled: boolean = true;
  /** Count of payloads already written to disk (used to skip empty persist calls). */
  private persistedCount: number = 0;

  static getInstance(): PayloadCapture {
    if (!PayloadCapture.instance) {
      PayloadCapture.instance = new PayloadCapture();
    }
    return PayloadCapture.instance;
  }

  enable(): void {
    this.enabled = true;
  }

  disable(): void {
    this.enabled = false;
  }

  /**
   * Capture a complete request/response pair
   * MANDATORY: Call this after every API request
   * FAIL FAST: Throws if capture fails and strict mode is enabled
   */
  async capture(
    testId: string,
    method: string,
    endpoint: string,
    requestPayload: any,
    response: { status: () => number; text: () => Promise<string>; headers: () => Record<string, string> },
    meta?: { language?: string; userKey?: string }
  ): Promise<CapturedPayload> {
    if (!this.enabled) {
      throw new Error(`[PayloadCapture] Payload capture is disabled for ${testId}. Capture is mandatory.`);
    }

    const timestamp = new Date().toISOString();
    const statusCode = response.status();

    // Capture request payload
    const capturedRequest = this.safeSerialize(requestPayload);

    // Capture response payload with safe parsing; response.text() can be read only once.
    let responseBody: any | string;
    try {
      const rawText = await response.text();
      responseBody = this.safeParseResponse(rawText, statusCode);
    } catch (e) {
      const error = e as Error;
      console.error(`[PayloadCapture] Failed to capture response for ${testId}: ${error.message}`);
      responseBody = `[CAPTURE_ERROR: ${error.message}]`;
    }

    const capture: CapturedPayload = {
      test_id: testId,
      method: method.toUpperCase(),
      endpoint,
      request_payload: capturedRequest,
      response_payload: responseBody,
      response_status_code: statusCode,
      timestamp,
      language: meta?.language,
      user_key: meta?.userKey,
    };

    // Store per test
    if (!this.payloads.has(testId)) {
      this.payloads.set(testId, []);
    }
    this.payloads.get(testId)!.push(capture);

    console.log(`[PayloadCapture] Captured ${method} ${endpoint} → HTTP ${statusCode} for ${testId}`);
    return capture;
  }

  /**
   * Get all captures for a specific test
   */
  getCaptures(testId: string): CapturedPayload[] {
    return this.payloads.get(testId) || [];
  }

  /**
   * Get the most recent capture for a test
   */
  getLastCapture(testId: string): CapturedPayload | null {
    const captures = this.payloads.get(testId);
    return captures && captures.length > 0 ? captures[captures.length - 1] : null;
  }

  /**
   * Get all captures across all tests
   */
  getAllCaptures(): CapturedPayload[] {
    const all: CapturedPayload[] = [];
    this.payloads.forEach(captures => all.push(...captures));
    return all;
  }

  /**
   * Clear all captured data
   */
  clear(): void {
    this.payloads.clear();
  }

  /**
   * Persist all captures to disk for cross-process report generation.
   * Each worker writes to its own file using PID to avoid collisions.
   */
  persistToDisk(): void {
    const captures = this.getAllCaptures();
    if (captures.length === 0 && this.persistedCount === 0) {
      return;
    }

    try {
      if (!fs.existsSync(PAYLOADS_DIR)) {
        fs.mkdirSync(PAYLOADS_DIR, { recursive: true });
      }

      const filename = `payloads-${process.pid}-${Date.now()}.json`;
      const filePath = path.join(PAYLOADS_DIR, filename);
      fs.writeFileSync(filePath, JSON.stringify(captures, null, 2), 'utf8');
      this.persistedCount = captures.length;
      console.log(`[PayloadCapture] Persisted ${captures.length} captures to ${filename}`);
    } catch (e) {
      console.error(`[PayloadCapture] Failed to persist captures to disk: ${(e as Error).message}`);
    }
  }

  /**
   * Load all persisted captures from disk (for report generation in separate process).
   * Merges all worker payload files into this instance.
   */
  static loadFromDisk(): Map<string, CapturedPayload[]> {
    const merged = new Map<string, CapturedPayload[]>();

    if (!fs.existsSync(PAYLOADS_DIR)) {
      console.warn(`[PayloadCapture] No payloads directory found at ${PAYLOADS_DIR}`);
      return merged;
    }

    const files = fs.readdirSync(PAYLOADS_DIR).filter(f => f.endsWith('.json'));
    let totalLoaded = 0;

    for (const file of files) {
      try {
        const filePath = path.join(PAYLOADS_DIR, file);
        const raw = fs.readFileSync(filePath, 'utf8');
        const captures: CapturedPayload[] = JSON.parse(raw);

        for (const capture of captures) {
          const testId = capture.test_id || 'UNKNOWN';
          if (!merged.has(testId)) {
            merged.set(testId, []);
          }
          merged.get(testId)!.push(capture);
          totalLoaded++;
        }
      } catch (e) {
        console.error(`[PayloadCapture] Failed to load ${file}: ${(e as Error).message}`);
      }
    }

    console.log(`[PayloadCapture] Loaded ${totalLoaded} captures from ${files.length} files.`);
    return merged;
  }

  /**
   * Clean up persisted payload files (call before new test run).
   */
  static cleanDiskPayloads(): void {
    if (!fs.existsSync(PAYLOADS_DIR)) return;

    const files = fs.readdirSync(PAYLOADS_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        fs.unlinkSync(path.join(PAYLOADS_DIR, file));
      } catch { /* ignore */ }
    }
    console.log(`[PayloadCapture] Cleaned ${files.length} persisted payload files.`);
  }

  /**
   * Safe JSON serialization with circular reference protection
   */
  private safeSerialize(data: any): any {
    if (data === null || data === undefined) {
      return null;
    }
    if (typeof data === 'string') {
      try {
        // Try to parse as JSON if it looks like JSON
        if (data.trim().startsWith('{') || data.trim().startsWith('[')) {
          return JSON.parse(data);
        }
      } catch {
        // Not valid JSON, return as string
      }
      return data;
    }
    if (typeof data === 'number' || typeof data === 'boolean') {
      return data;
    }
    if (Array.isArray(data)) {
      return data.map(item => this.safeSerialize(item));
    }
    if (typeof data === 'object') {
      const result: Record<string, any> = {};
      for (const [key, value] of Object.entries(data)) {
        result[key] = this.safeSerialize(value);
      }
      return result;
    }
    return String(data);
  }

  /**
   * Safe response parsing - returns object for JSON, string for non-JSON
   */
  private safeParseResponse(rawText: string, statusCode: number): any | string {
    const trimmed = rawText.replace(/^\uFEFF/, '').trim();

    // Handle empty responses (e.g., 204 No Content)
    if (!trimmed) {
      return statusCode === 204 ? {} : '[EMPTY_RESPONSE]';
    }

    // Try JSON parsing
    try {
      return JSON.parse(trimmed);
    } catch {
      // Not JSON, return raw text (truncated if very large)
      const maxLength = 10000;
      if (trimmed.length > maxLength) {
        return trimmed.substring(0, maxLength) + `\n...[truncated ${trimmed.length - maxLength} chars]`;
      }
      return trimmed;
    }
  }

  /**
   * Validate that a test has captured payloads.
   * FAIL FAST: Throws if no payloads found.
   * STRENGTHENED: Also checks payload content quality and warns on issues.
   */
  validateCapture(testId: string): CapturedPayload {
    const capture = this.getLastCapture(testId);

    // Validation Level 1: Existence check
    if (!capture) {
      throw new Error(
        `[PayloadCapture] VALIDATION FAILED: No payload captured for ${testId}.\n` +
        `Every test MUST capture request_payload, response_payload, and response_status_code.\n` +
        `Ensure controller methods call PayloadCapture.capture() after each API request.`
      );
    }

    // Validation Level 2: Content quality checks (warnings, not errors)
    const hasEmptyPayloads = !capture.request_payload && !capture.response_payload;
    const hasInvalidResponse = typeof capture.response_payload === 'string' &&
      capture.response_payload.startsWith('[CAPTURE_ERROR');

    if (hasEmptyPayloads) {
      console.warn(
        `[PayloadCapture] WARNING: ${testId} has capture but BOTH payloads are empty. ` +
        `Report will show {}. This may be valid for certain test types (e.g., GET with no body), ` +
        `but verify capture is working correctly.`
      );
    }

    if (hasInvalidResponse) {
      console.error(
        `[PayloadCapture] ERROR: ${testId} response capture failed: ${capture.response_payload}. ` +
        `Response parsing error occurred.`
      );
    }

    // Validation Level 3: HTTP status captured
    if (!capture.response_status_code || capture.response_status_code === 0) {
      console.warn(
        `[PayloadCapture] WARNING: ${testId} has no HTTP status code captured (got ${capture.response_status_code}). ` +
        `Ensure response object is valid when calling capture().`
      );
    }

    return capture;
  }
}
