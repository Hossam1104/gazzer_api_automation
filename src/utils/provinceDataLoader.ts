/**
 * @file provinceDataLoader.ts
 * @description Province and zone data sourcing with API-first, fallback-safe strategy.
 *
 * Fetches province and zone reference data from the live API on first call,
 * then caches it in module-level variables for the remainder of the test run.
 * If the API is unreachable, falls back to hardcoded defaults so tests can
 * still generate valid address payloads.
 *
 * Data source ('API' or 'fallback') is recorded via {@link ExecutionTracker}
 * for the report to indicate data provenance.
 *
 * @module provinceDataLoader
 */
import fs from 'fs';
import path from 'path';
import { GlobalConfig } from '@/config/global.config';
import { ExecutionTracker } from '@/utils/executionTracker';

export interface ProvinceData {
  id: number;
  name: string;
  name_en?: string;
  name_ar?: string;
}

export interface ProvinceZoneData {
  id: number;
  province_id: number;
  name: string;
  name_en?: string;
  name_ar?: string;
}

// Cached per run to avoid repeated API calls during dynamic test generation.
// Module-level caching is safe because Playwright workers are isolated processes.
let provinceCache: ProvinceData[] | null = null;
let zoneCache: ProvinceZoneData[] | null = null;
/** Tracks whether data came from the live API or hardcoded fallback. */
let dataSource: string = 'unknown';

/**
 * Fetches provinces and zones from the API. Returns cached data on subsequent calls.
 * Falls back to hardcoded defaults if the API is unreachable.
 *
 * @param request - HTTP client with a .get() method (Playwright API context)
 * @param testId - Optional test ID for recording the data source
 * @returns Object containing province and zone arrays
 */
export async function loadProvinceDataFromApi(
  request: { get: (url: string, options?: any) => Promise<any> },
  testId?: string
): Promise<{ provinces: ProvinceData[]; zones: ProvinceZoneData[] }> {
  if (provinceCache && zoneCache) {
    return { provinces: provinceCache, zones: zoneCache };
  }

  try {
    const baseUrl = GlobalConfig.baseUrl;

    // Fetch provinces
    const provRes = await request.get(`${baseUrl}/api/provinces`, {
      headers: { 'Accept': 'application/json' }
    });
    if (provRes.ok()) {
      const provBody = JSON.parse((await provRes.text()).replace(/^\uFEFF/, '').trim());
      provinceCache = (provBody.data || provBody || []).map((p: any) => ({
        id: p.id,
        name: p.name || p.name_en || p.title || `Province-${p.id}`,
        name_en: p.name_en || p.name || '',
        name_ar: p.name_ar || '',
      }));
    }

    // Fetch zones
    const zoneRes = await request.get(`${baseUrl}/api/province-zones`, {
      headers: { 'Accept': 'application/json' }
    });
    if (zoneRes.ok()) {
      const zoneBody = JSON.parse((await zoneRes.text()).replace(/^\uFEFF/, '').trim());
      zoneCache = (zoneBody.data || zoneBody || []).map((z: any) => ({
        id: z.id,
        province_id: z.province_id,
        name: z.name || z.name_en || z.title || `Zone-${z.id}`,
        name_en: z.name_en || z.name || '',
        name_ar: z.name_ar || '',
      }));
    }

    dataSource = 'API';

  } catch (e) {
    console.warn(`[ProvinceLoader] API fetch failed: ${e}. Using fallback defaults.`);
    dataSource = 'fallback';
  }

  if (!provinceCache || provinceCache.length === 0) {
    provinceCache = [
      { id: 1, name: 'Default Province', name_en: 'Default Province', name_ar: 'المحافظة الافتراضية' }
    ];
    dataSource = 'fallback';
  }

  if (!zoneCache || zoneCache.length === 0) {
    zoneCache = [
      { id: 1, province_id: 1, name: 'Default Zone', name_en: 'Default Zone', name_ar: 'المنطقة الافتراضية' }
    ];
  }

  if (testId) {
    ExecutionTracker.recordProvinceSource(testId, dataSource);
  }

  return { provinces: provinceCache, zones: zoneCache };
}

/** Returns a random province from the cached data, or null if not loaded. */
export function getRandomProvince(): ProvinceData | null {
  if (!provinceCache || provinceCache.length === 0) return null;
  return provinceCache[Math.floor(Math.random() * provinceCache.length)];
}

/** Returns a random zone, optionally filtered by province_id. Falls back to first zone if no match. */
export function getRandomZone(provinceId?: number): ProvinceZoneData | null {
  if (!zoneCache || zoneCache.length === 0) return null;
  const filtered = provinceId ? zoneCache.filter(z => z.province_id === provinceId) : zoneCache;
  if (filtered.length === 0) return zoneCache[0];
  return filtered[Math.floor(Math.random() * filtered.length)];
}

/** Returns the current data source label ('API', 'fallback', or 'unknown'). */
export function getProvinceDataSource(): string {
  return dataSource;
}
