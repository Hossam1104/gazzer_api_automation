/**
 * @file globalSetup.ts
 * @description Playwright global setup — runs ONCE before all spec files.
 *
 * Cleans stale payload files from previous test runs so the report pipeline
 * only sees fresh captures from the current execution. This must happen at
 * the global level (not per-spec) to avoid one spec deleting another spec's
 * already-persisted payload files.
 *
 * @module globalSetup
 */
import fs from 'fs';
import path from 'path';

const PAYLOADS_DIR = path.resolve(__dirname, '../../test-results/payloads');

export default function globalSetup() {
  if (fs.existsSync(PAYLOADS_DIR)) {
    const files = fs.readdirSync(PAYLOADS_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        fs.unlinkSync(path.join(PAYLOADS_DIR, file));
      } catch { /* ignore */ }
    }
    if (files.length > 0) {
      console.log(`[GlobalSetup] Cleaned ${files.length} stale payload files from previous run.`);
    }
  }
}
