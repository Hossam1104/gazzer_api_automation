/**
 * @file requestGovernor.ts
 * @description Centralized request queue with adaptive throttling and system-wide
 * rate-limit awareness.
 *
 * All outbound API requests MUST flow through this governor to ensure:
 *   - FIFO execution with concurrency cap (max 2 simultaneous)
 *   - Minimum inter-request delay (configurable, adaptive)
 *   - System-wide 429 tracking across all API calls
 *   - Automatic system pause when sustained 429s detected
 *   - Priority-based queuing (cleanup operations yield to functional flows)
 *   - Telemetry hooks for execution tracking and reporting
 *
 * @see {@link ClientAddressesController} — wraps action() calls through this governor
 * @see {@link StateTracker} — uses governor for state capture and cleanup
 * @see {@link CapacityHelper} — uses governor for capacity management
 *
 * @module requestGovernor
 */

export interface GovernorConfig {
  maxConcurrent: number;
  minInterRequestDelayMs: number;
  adaptiveMultiplier: number;
  sustainedThreshold: number;
  systemPauseDurationMs: number;
  rateLimitWindowMs: number;
}

export interface GovernorTelemetry {
  totalRequests: number;
  total429s: number;
  systemPauses: number;
  currentDelayMs: number;
  last429Timestamp: number | null;
  rateLimitRate: number;
}

export type RequestPriority = 'HIGH' | 'NORMAL' | 'LOW';

interface RequestContext {
  testId: string;
  priority: RequestPriority;
  label: string;
}

const DEFAULT_CONFIG: GovernorConfig = {
  maxConcurrent: 2,
  minInterRequestDelayMs: 150,
  adaptiveMultiplier: 1.5,
  sustainedThreshold: 5,
  systemPauseDurationMs: 10000,
  rateLimitWindowMs: 30000,
};

/**
 * Centralized request governor ensuring all API calls are throttled,
 * tracked, and paused when the backend signals overload.
 *
 * Singleton — initialized lazily on first access. Configuration can be
 * set via {@link configure} before first use, or will use defaults.
 */
export class RequestGovernor {
  private static instance: RequestGovernor;
  private config: GovernorConfig;

  // Concurrency control
  private activeRequests: number = 0;
  private waitQueue: Array<() => void> = [];

  // Throttle control
  private lastRequestTimestamp: number = 0;
  private currentDelay: number;

  // Rate limit tracking
  private consecutive429s: number = 0;
  private windowEvents: Array<{ timestamp: number; status: number }> = [];

  // System pause
  private systemPaused: boolean = false;
  private pausePromise: Promise<void> | null = null;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private pauseResolve: (() => void) | null = null;

  // Telemetry
  private totalRequests: number = 0;
  private total429s: number = 0;
  private systemPauseCount: number = 0;

  private constructor(config: GovernorConfig) {
    this.config = config;
    this.currentDelay = config.minInterRequestDelayMs;
  }

  static getInstance(): RequestGovernor {
    if (!RequestGovernor.instance) {
      RequestGovernor.instance = new RequestGovernor(DEFAULT_CONFIG);
    }
    return RequestGovernor.instance;
  }

  /**
   * Configures the governor before first use. Merges partial config with defaults.
   * Must be called before getInstance() for custom settings to take effect,
   * or call on the existing instance to update settings at runtime.
   */
  static configure(config: Partial<GovernorConfig>): void {
    const merged = { ...DEFAULT_CONFIG, ...config };
    if (RequestGovernor.instance) {
      RequestGovernor.instance.config = merged;
      RequestGovernor.instance.currentDelay = merged.minInterRequestDelayMs;
    } else {
      RequestGovernor.instance = new RequestGovernor(merged);
    }
  }

  /** Resets singleton for testing or fresh runs. */
  static reset(): void {
    RequestGovernor.instance = undefined as any;
  }

  /**
   * Wraps an async action with throttle, concurrency control, and telemetry.
   *
   * Flow:
   *   1. Wait for system pause to end (if active)
   *   2. Wait for concurrency slot (max 2 active)
   *   3. Enforce minimum inter-request delay
   *   4. Execute action
   *   5. Release slot, notify next queued request
   *
   * LOW-priority requests yield to higher-priority ones in the queue.
   */
  async execute<T>(action: () => Promise<T>, context: RequestContext): Promise<T> {
    // Wait for system pause to end
    if (this.systemPaused && this.pausePromise) {
      await this.pausePromise;
    }

    // Wait for concurrency slot
    await this.acquireSlot(context.priority);

    // Enforce minimum inter-request delay
    await this.enforceDelay();

    try {
      this.totalRequests++;
      return await action();
    } finally {
      this.releaseSlot();
    }
  }

  /**
   * Records an HTTP response status for rate-limit tracking.
   * Called by the controller after every API response.
   *
   * On 429: increments consecutive counter, checks for system pause trigger.
   * On non-429: resets consecutive counter, potentially reduces adaptive delay.
   */
  recordResponse(status: number, testId: string): void {
    const now = Date.now();

    // Track in sliding window
    this.windowEvents.push({ timestamp: now, status });
    this.pruneWindow(now);

    if (status === 429) {
      this.total429s++;
      this.consecutive429s++;

      // Adaptive delay: increase when 429s detected
      const previousDelay = this.currentDelay;
      this.currentDelay = Math.min(
        this.currentDelay * this.config.adaptiveMultiplier,
        5000 // Cap at 5s max delay
      );
      if (this.currentDelay !== previousDelay) {
        console.warn(
          `[Governor] Adaptive delay increased: ${Math.round(previousDelay)}ms → ${Math.round(this.currentDelay)}ms ` +
          `(consecutive 429s: ${this.consecutive429s})`
        );
      }

      // System pause when sustained 429s
      if (this.consecutive429s >= this.config.sustainedThreshold && !this.systemPaused) {
        this.triggerSystemPause(
          `${this.consecutive429s} consecutive 429s detected for test ${testId}`
        );
      }
    } else {
      // Reset consecutive counter on success
      if (this.consecutive429s > 0) {
        this.consecutive429s = 0;
        // Gradually reduce adaptive delay back toward base
        this.currentDelay = Math.max(
          this.config.minInterRequestDelayMs,
          this.currentDelay * 0.8
        );
      }
    }
  }

  /**
   * Pre-test API availability check.
   * Makes a lightweight GET request to the base URL and measures latency.
   */
  async healthCheck(baseUrl: string): Promise<{ healthy: boolean; latencyMs: number }> {
    const start = Date.now();
    try {
      // Use native fetch for health check (doesn't need auth)
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const response = await fetch(`${baseUrl}/api/clients/addresses`, {
        method: 'HEAD',
        signal: controller.signal,
        headers: { 'Accept': 'application/json' },
      }).catch(() => null);
      clearTimeout(timeout);

      const latencyMs = Date.now() - start;
      // Any response (including 401) means API is reachable
      const healthy = response !== null && response.status !== 0;
      return { healthy, latencyMs };
    } catch {
      return { healthy: false, latencyMs: Date.now() - start };
    }
  }

  /** Returns current telemetry snapshot for report generation. */
  getTelemetry(): GovernorTelemetry {
    const now = Date.now();
    this.pruneWindow(now);
    const recent429s = this.windowEvents.filter(e => e.status === 429).length;
    const windowSeconds = this.config.rateLimitWindowMs / 1000;

    return {
      totalRequests: this.totalRequests,
      total429s: this.total429s,
      systemPauses: this.systemPauseCount,
      currentDelayMs: Math.round(this.currentDelay),
      last429Timestamp: this.total429s > 0
        ? this.windowEvents.filter(e => e.status === 429).pop()?.timestamp || null
        : null,
      rateLimitRate: Math.round((recent429s / windowSeconds) * 60 * 100) / 100,
    };
  }

  /** Returns true if the current 429 rate exceeds 50% of requests in the window. */
  isSaturated(): boolean {
    const now = Date.now();
    this.pruneWindow(now);
    if (this.windowEvents.length < 3) return false;
    const rate429 = this.windowEvents.filter(e => e.status === 429).length / this.windowEvents.length;
    return rate429 > 0.5;
  }

  // ── Private Methods ──

  private async acquireSlot(priority: RequestPriority): Promise<void> {
    if (this.activeRequests < this.config.maxConcurrent) {
      this.activeRequests++;
      return;
    }

    // Queue and wait
    return new Promise<void>(resolve => {
      // Wrap resolve to increment activeRequests when called
      const release = () => {
        this.activeRequests++;
        resolve();
      };

      if (priority === 'LOW') {
        // LOW priority goes to back of queue
        this.waitQueue.push(release);
      } else {
        // HIGH/NORMAL go to front
        this.waitQueue.unshift(release);
      }
    });
  }

  private releaseSlot(): void {
    this.activeRequests = Math.max(0, this.activeRequests - 1);
    if (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift();
      if (next) next();
    }
  }

  private async enforceDelay(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTimestamp;
    const remaining = this.currentDelay - elapsed;

    if (remaining > 0) {
      await new Promise(r => setTimeout(r, remaining));
    }

    this.lastRequestTimestamp = Date.now();
  }

  private triggerSystemPause(reason: string): void {
    if (this.systemPaused) return;

    this.systemPaused = true;
    this.systemPauseCount++;
    const duration = this.config.systemPauseDurationMs;

    console.warn(
      `[Governor] ⚠️ SYSTEM PAUSE: ${reason}. ` +
      `All requests halted for ${duration}ms. ` +
      `Total 429s: ${this.total429s}, Pauses: ${this.systemPauseCount}`
    );

    this.pausePromise = new Promise<void>(resolve => {
      this.pauseResolve = resolve;
      setTimeout(() => {
        this.systemPaused = false;
        this.consecutive429s = 0;
        // Reset delay to base after cooldown
        this.currentDelay = this.config.minInterRequestDelayMs;
        console.log(`[Governor] System pause ended. Delay reset to ${this.currentDelay}ms.`);
        resolve();
        this.pauseResolve = null;
      }, duration);
    });
  }

  private pruneWindow(now: number): void {
    const cutoff = now - this.config.rateLimitWindowMs;
    this.windowEvents = this.windowEvents.filter(e => e.timestamp > cutoff);
  }
}
