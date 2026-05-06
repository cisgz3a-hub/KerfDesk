/**
 * T2-116: storage health and quota reporting. Pre-T2-116 there was
 * no surface that answered "how full is storage, and what's
 * happening to my data?". When storage filled up, autosave failed
 * silently (T1-68 caught the QuotaExceededError but the user never
 * saw the consequence).
 *
 * Audit 5C Required Priority 13. T2-116 ships the type + a builder
 * that classifies keys by domain prefix + the warning predicate.
 * Wiring the live storage adapter + `navigator.storage.estimate()`
 * + the diagnostics panel surface is filed as T2-116-followup since
 * each consumer (support bundle T2-108, troubleshooting panel
 * T2-118) integrates independently.
 */

export type StorageDomain =
  | 'autosave'
  | 'jobLogs'
  | 'replays'
  | 'deviceProfiles'
  | 'materials'
  | 'licenseCache'
  | 'settings'
  | 'history'
  | 'correlationState'
  | 'other';

export interface DomainBreakdown {
  autosave: number;
  jobLogs: number;
  replays: number;
  deviceProfiles: number;
  materials: number;
  licenseCache: number;
  settings: number;
  history: number;
  correlationState: number;
  other: number;
}

export interface QuotaInfo {
  bytesUsed: number;
  bytesAvailable: number;
  /** 0-100, two decimal places. */
  percentUsed: number;
}

export interface SaveFailure {
  timestamp: string;
  domain: StorageDomain;
  error: string;
}

export interface PrunedRecord {
  timestamp: string;
  domain: StorageDomain;
  reason: 'quota' | 'retention-cap';
  count: number;
}

export interface StorageHealth {
  totalBytes: number;
  byDomain: DomainBreakdown;
  quota?: QuotaInfo;
  lastSaveFailures: SaveFailure[];
  prunedRecords: PrunedRecord[];
}

/**
 * Map a storage key prefix to its domain. Mirrors the prefixes used
 * across `src/core/storage/` (autosave / job log / replay / device
 * profile / material preset / license cache / settings / history)
 * — the canonical strings the storage adapter writes today.
 */
export function classifyKey(key: string): StorageDomain {
  if (key.startsWith('laserforge_autosave')) return 'autosave';
  if (key.startsWith('laserforge_job_log') || key.startsWith('joblog_')) return 'jobLogs';
  if (key.startsWith('laserforge_replay') || key.startsWith('replay_')) return 'replays';
  if (key.startsWith('laserforge_device_profile') || key.startsWith('deviceProfile_')) return 'deviceProfiles';
  if (key.startsWith('laserforge_material') || key.startsWith('materialPreset_')) return 'materials';
  if (key.startsWith('laserforge_license') || key === 'laserforge_pro') return 'licenseCache';
  if (key.startsWith('laserforge_history')) return 'history';
  if (key.startsWith('laserforge_correlation')) return 'correlationState';
  if (key.startsWith('laserforge_settings') || key.startsWith('laserforge_window')) return 'settings';
  return 'other';
}

export function emptyDomainBreakdown(): DomainBreakdown {
  return {
    autosave: 0, jobLogs: 0, replays: 0, deviceProfiles: 0,
    materials: 0, licenseCache: 0, settings: 0, history: 0,
    correlationState: 0, other: 0,
  };
}

export function emptyStorageHealth(): StorageHealth {
  return {
    totalBytes: 0,
    byDomain: emptyDomainBreakdown(),
    lastSaveFailures: [],
    prunedRecords: [],
  };
}

/**
 * Estimate the byte size of a stored value. Strings are byte-length
 * via Buffer-equivalent rules: ASCII = 1 byte, but the dominant
 * cost in this codebase is JSON of multi-byte content, so use a
 * conservative `2 * length`. Non-string values (the storage adapter
 * accepts strings only today) are JSON-stringified first.
 */
export function estimateValueBytes(value: unknown): number {
  if (typeof value === 'string') return value.length * 2;
  if (value === null || value === undefined) return 0;
  try {
    return JSON.stringify(value).length * 2;
  } catch {
    return 0;
  }
}

/**
 * Pure builder. The caller harvests `(key, value)` entries from the
 * storage adapter (or `localStorage` snapshot) and hands them in;
 * the builder classifies + sums.
 *
 * Optional `quota` from `navigator.storage.estimate()` is honoured
 * when supplied; `percentUsed` derives from it.
 */
export interface BuildHealthArgs {
  entries: Array<[string, unknown]>;
  quotaBytesUsed?: number;
  quotaBytesAvailable?: number;
  lastSaveFailures?: SaveFailure[];
  prunedRecords?: PrunedRecord[];
}

export function buildStorageHealth(args: BuildHealthArgs): StorageHealth {
  const byDomain = emptyDomainBreakdown();
  let total = 0;
  for (const [key, value] of args.entries) {
    const domain = classifyKey(key);
    const bytes = estimateValueBytes(value);
    byDomain[domain] += bytes;
    total += bytes;
  }
  const health: StorageHealth = {
    totalBytes: total,
    byDomain,
    lastSaveFailures: args.lastSaveFailures ?? [],
    prunedRecords: args.prunedRecords ?? [],
  };
  if (args.quotaBytesUsed != null && args.quotaBytesAvailable != null
      && args.quotaBytesAvailable > 0) {
    health.quota = {
      bytesUsed: args.quotaBytesUsed,
      bytesAvailable: args.quotaBytesAvailable,
      percentUsed: Math.round(
        (args.quotaBytesUsed / args.quotaBytesAvailable) * 10000,
      ) / 100,
    };
  }
  return health;
}

/**
 * "Storage nearly full" predicate the troubleshooting panel uses to
 * decide whether to render the warning banner.
 */
export const STORAGE_WARNING_THRESHOLD_PERCENT = 80;

export function isStorageWarning(health: StorageHealth): boolean {
  if (health.quota && health.quota.percentUsed >= STORAGE_WARNING_THRESHOLD_PERCENT) return true;
  // Recent save failure within last 5 minutes is also a warning even
  // when quota is unknown.
  const fiveMinAgo = Date.now() - 5 * 60 * 1000;
  for (const f of health.lastSaveFailures) {
    if (Date.parse(f.timestamp) > fiveMinAgo) return true;
  }
  return false;
}

/** User-facing summary line. */
export function describeStorageHealth(health: StorageHealth): string {
  const totalMb = (health.totalBytes / 1024 / 1024).toFixed(1);
  if (health.quota) {
    const usedMb = (health.quota.bytesUsed / 1024 / 1024).toFixed(1);
    const availMb = (health.quota.bytesAvailable / 1024 / 1024).toFixed(0);
    return `${usedMb} MB / ${availMb} MB available (${health.quota.percentUsed}%)`;
  }
  return `${totalMb} MB stored`;
}
