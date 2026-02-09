/**
 * @file executionTracker.ts
 * @description Per-test execution metadata tracker with disk persistence.
 *
 * Records contextual metadata for each test case (users, languages, cleanup
 * actions, rate-limit events, province data source) and persists it to
 * test-results/execution-meta.json. This metadata is consumed by
 * {@link ReportExporter} to enrich the HTML report with execution context.
 *
 * Persistence is eager (written on every record call) because tests may crash
 * and we need metadata even for partially-executed runs.
 *
 * @module executionTracker
 */
import * as fs from 'fs';
import * as path from 'path';

/** Metadata recorded per test case during execution. */
export type ExecutionMeta = {
  users?: string[];
  tokenSource?: string;
  languages?: string[];
  cleanupActions?: string[];
  rateLimitEvents?: string[];
  provinceSource?: string;
  governorStats?: { delay: number; pauses: number; total429s: number };
  retryHistory?: string[];
  failureCategory?: string;
};

/** Absolute path to the shared metadata file (read/written by all workers). */
const META_FILE_PATH = path.resolve(__dirname, '../../test-results/execution-meta.json');

/**
 * Static class for recording and retrieving per-test execution metadata.
 * Lazy-loads existing metadata from disk on first access.
 * Every mutation is immediately persisted to survive worker crashes.
 */
export class ExecutionTracker {
  private static metaByTest: Map<string, ExecutionMeta> = new Map();
  private static loaded = false;

  /** Lazy-load existing metadata from disk on first access. */
  private static ensureLoaded() {
    if (!this.loaded) {
      if (fs.existsSync(META_FILE_PATH)) {
        try {
          const raw = fs.readFileSync(META_FILE_PATH, 'utf8');
          const data = JSON.parse(raw);
          this.metaByTest = new Map(Object.entries(data));
        } catch (e) {
          console.error('[ExecutionTracker] Failed to load meta file:', e);
        }
      }
      this.loaded = true;
    }
  }

  /** Write the full metadata map to disk (called after every mutation). */
  private static persist() {
    try {
      const data = Object.fromEntries(this.metaByTest);
      const dir = path.dirname(META_FILE_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(META_FILE_PATH, JSON.stringify(data, null, 2));
    } catch (e) {
      console.error('[ExecutionTracker] Failed to persist meta file:', e);
    }
  }

  /** Returns or creates the metadata entry for a given test ID. */
  private static getOrCreate(testId: string): ExecutionMeta {
    this.ensureLoaded();
    if (!this.metaByTest.has(testId)) {
      this.metaByTest.set(testId, {});
    }
    return this.metaByTest.get(testId)!;
  }

  /** Records which user (and token source) executed a given test. */
  static recordUser(testId: string, userKey: string, tokenSource: string) {
    const meta = this.getOrCreate(testId);
    const users = new Set(meta.users || []);
    users.add(userKey);
    meta.users = Array.from(users);
    meta.tokenSource = tokenSource;
    this.persist();
  }

  /** Records which Accept-Language header was used for a test. */
  static recordLanguage(testId: string, language: string) {
    const meta = this.getOrCreate(testId);
    const langs = new Set(meta.languages || []);
    langs.add(language);
    meta.languages = Array.from(langs);
    this.persist();
  }

  /** Records address cleanup actions performed during a test (e.g., logical cleanup). */
  static recordCleanup(testId: string, action: string) {
    const meta = this.getOrCreate(testId);
    meta.cleanupActions = [...(meta.cleanupActions || []), action];
    this.persist();
  }

  /** Records rate-limit events and user switches for traceability. */
  static recordRateLimit(testId: string, details: string) {
    const meta = this.getOrCreate(testId);
    meta.rateLimitEvents = [...(meta.rateLimitEvents || []), details];
    this.persist();
  }

  /** Records whether province/zone data came from the API or from fallback defaults. */
  static recordProvinceSource(testId: string, source: string) {
    const meta = this.getOrCreate(testId);
    meta.provinceSource = source;
    this.persist();
  }

  /** Records governor telemetry snapshot for a test. */
  static recordGovernorStats(testId: string, stats: { delay: number; pauses: number; total429s: number }) {
    const meta = this.getOrCreate(testId);
    meta.governorStats = stats;
    this.persist();
  }

  /** Records a retry attempt for traceability. */
  static recordRetry(testId: string, detail: string) {
    const meta = this.getOrCreate(testId);
    meta.retryHistory = [...(meta.retryHistory || []), detail];
    this.persist();
  }

  /** Records the classified failure category for a test. */
  static recordFailureCategory(testId: string, category: string) {
    const meta = this.getOrCreate(testId);
    meta.failureCategory = category;
    this.persist();
  }

  /** Retrieves metadata for a given test ID, or null if none recorded. */
  static getMeta(testId: string): ExecutionMeta | null {
    this.ensureLoaded();
    return this.metaByTest.get(testId) || null;
  }
}
