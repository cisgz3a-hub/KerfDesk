import { getStorage } from '../core/storage/storage';

/**
 * T2-69: atomic autosave record. Pre-T2-69 the autosave write was two
 * sequential `storage.set` calls — JSON to one key, ISO timestamp to
 * another. If the browser crashed between them the JSON was current
 * but the timestamp stale (or absent — `readAutosave` defaulted to
 * `new Date().toISOString()` which masked the inconsistency); a
 * concurrent reader in another tab could observe a partial state.
 *
 * Now everything goes into one record under `laserforge_autosave_record`,
 * written in a single `storage.set`. The legacy two-key format is read
 * once on first call and migrated forward — no out-of-band migration
 * step needed.
 */

/** Legacy two-key autosave format. Read-only after T2-69 — one-shot
 *  migration on first read. */
const AUTOSAVE_KEY = 'laserforge_autosave';
const AUTOSAVE_TIME_KEY = 'laserforge_autosave_time';

/** T2-69: single atomic key. */
const AUTOSAVE_RECORD_KEY = 'laserforge_autosave_record';

/** Pinned schema version; bump if the record shape changes
 *  incompatibly. */
const AUTOSAVE_RECORD_VERSION = 1;

/**
 * T2-69: serialized atomic record. Carries enough metadata that the
 * recovery dialog (T1-71) can show "scene name + N objects + N layers,
 * saved 12 minutes ago" without parsing the JSON body, and the
 * `checksum` lets readers detect storage corruption (the typical
 * cause being a partial localStorage quota-exceeded write).
 */
export interface AutosaveRecord {
  version: typeof AUTOSAVE_RECORD_VERSION;
  json: string;                // serialized scene
  timestamp: string;           // ISO 8601
  checksum: string;            // FNV-1a 32-bit hex of `json`
  sceneName?: string;
  objectCount?: number;
  layerCount?: number;
}

export interface AutosavePayload {
  json: string;
  timestamp: string;
  /** T2-69: optional richer metadata for callers that want it. */
  record?: AutosaveRecord;
}

let _migrationAttempted = false;
let _recordMigrationAttempted = false;

/**
 * T2-69: FNV-1a 32-bit content hash of a UTF-16 string. Not
 * cryptographic — it's a corruption check, not a tamper check.
 * Detects partial writes / storage truncation / encoding glitches in
 * the autosave JSON; a sha256 upgrade is filed under T3-77.
 */
function fnv1a32Hex(s: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i) & 0xff;
    hash = Math.imul(hash, 0x01000193);
    // Mix the high byte too for stability against char codes >= 256.
    hash ^= (s.charCodeAt(i) >> 8) & 0xff;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function extractRecordMetadata(json: string): { sceneName?: string; objectCount?: number; layerCount?: number } {
  // Best-effort metadata extraction. The autosave JSON is a Scene
  // serialization; if parsing fails we just omit metadata. The
  // headline checksum + json round-trip stays valid.
  try {
    const parsed = JSON.parse(json) as {
      scene?: { name?: string; objects?: unknown[]; layers?: unknown[] };
      name?: string;
      objects?: unknown[];
      layers?: unknown[];
    };
    const sceneish = parsed.scene ?? parsed;
    return {
      sceneName: typeof sceneish.name === 'string' ? sceneish.name : undefined,
      objectCount: Array.isArray(sceneish.objects) ? sceneish.objects.length : undefined,
      layerCount: Array.isArray(sceneish.layers) ? sceneish.layers.length : undefined,
    };
  } catch {
    return {};
  }
}

function buildRecord(json: string, timestamp = new Date().toISOString()): AutosaveRecord {
  const meta = extractRecordMetadata(json);
  return {
    version: AUTOSAVE_RECORD_VERSION,
    json,
    timestamp,
    checksum: fnv1a32Hex(json),
    sceneName: meta.sceneName,
    objectCount: meta.objectCount,
    layerCount: meta.layerCount,
  };
}

function parseRecord(raw: string): AutosaveRecord | null {
  try {
    const parsed = JSON.parse(raw) as Partial<AutosaveRecord>;
    if (
      typeof parsed.json === 'string' &&
      typeof parsed.timestamp === 'string' &&
      typeof parsed.checksum === 'string' &&
      typeof parsed.version === 'number'
    ) {
      return {
        version: AUTOSAVE_RECORD_VERSION,
        json: parsed.json,
        timestamp: parsed.timestamp,
        checksum: parsed.checksum,
        sceneName: typeof parsed.sceneName === 'string' ? parsed.sceneName : undefined,
        objectCount: typeof parsed.objectCount === 'number' ? parsed.objectCount : undefined,
        layerCount: typeof parsed.layerCount === 'number' ? parsed.layerCount : undefined,
      };
    }
  } catch {
    /* fall through */
  }
  return null;
}

/**
 * T2-69: returns true if the record's stored checksum matches the FNV-1a
 * of its `json` field. Callers MAY surface a "save may be corrupted"
 * warning to the user on mismatch; the JSON is still returned so a
 * partial recovery is possible.
 */
export function autosaveRecordChecksumValid(record: AutosaveRecord): boolean {
  return record.checksum === fnv1a32Hex(record.json);
}

async function migrateAutosaveFromLocalStorage(): Promise<void> {
  if (_migrationAttempted) return;
  _migrationAttempted = true;
  if (typeof localStorage === 'undefined') return;

  const storage = getStorage();
  for (const key of [AUTOSAVE_KEY, AUTOSAVE_TIME_KEY]) {
    try {
      const legacy = localStorage.getItem(key);
      if (legacy === null) continue;
      const existing = await storage.get(key);
      if (existing !== null) continue;
      await storage.set(key, legacy);
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}

/** Write autosave. Sync signature, fire-and-forget internally. */
export function writeAutosave(json: string): void {
  void persistAutosave(json).catch((err: unknown) => {
    console.warn('[LaserForge] Autosave failed:', err);
  });
}

/**
 * Write autosave. Awaitable. Rejects if the underlying storage rejects.
 * Use this when the caller needs to gate post-save state changes (e.g.
 * clearing a dirty flag) on the write actually succeeding.
 */
export async function writeAutosaveAsync(json: string): Promise<void> {
  await persistAutosave(json);
}

async function persistAutosave(json: string): Promise<void> {
  await migrateAutosaveFromLocalStorage();
  await migrateAutosaveToRecordKey();
  const storage = getStorage();
  const record = buildRecord(json);
  // T2-69: single atomic write replaces the pre-T2-69 two-key sequence.
  await storage.set(AUTOSAVE_RECORD_KEY, JSON.stringify(record));
}

/**
 * T2-69: one-shot migration from the legacy two-key format
 * (AUTOSAVE_KEY + AUTOSAVE_TIME_KEY) to the atomic record. Runs once
 * per process; idempotent — if the new key already exists, leaves
 * the old keys alone (a future cleanup pass can remove them; doing it
 * here would be destructive on the read path before we know the new
 * record is valid).
 */
async function migrateAutosaveToRecordKey(): Promise<void> {
  if (_recordMigrationAttempted) return;
  _recordMigrationAttempted = true;
  const storage = getStorage();
  try {
    const existing = await storage.get(AUTOSAVE_RECORD_KEY);
    if (existing) return;
    const [oldJson, oldTime] = await Promise.all([
      storage.get(AUTOSAVE_KEY),
      storage.get(AUTOSAVE_TIME_KEY),
    ]);
    if (!oldJson) return;
    const record = buildRecord(oldJson, oldTime ?? new Date().toISOString());
    await storage.set(AUTOSAVE_RECORD_KEY, JSON.stringify(record));
    // Old keys retained for one rollback cycle; a future commit can
    // remove them once the new path is proven in the wild.
  } catch {
    /* ignore migration failures — read path falls back to legacy keys */
  }
}

/** Read autosave. Async. Returns null if none. */
export async function readAutosave(): Promise<AutosavePayload | null> {
  await migrateAutosaveFromLocalStorage();
  await migrateAutosaveToRecordKey();
  const storage = getStorage();
  try {
    const raw = await storage.get(AUTOSAVE_RECORD_KEY);
    if (raw) {
      const record = parseRecord(raw);
      if (record != null) {
        return {
          json: record.json,
          timestamp: record.timestamp,
          record,
        };
      }
      // Record key exists but parse failed — fall through to legacy
      // path so the user doesn't lose their work to a corrupted
      // record.
    }
    // Legacy path: two keys read in parallel. Reached when migration
    // hadn't run, the record key was corrupt, or this is a fresh
    // install with no autosave at all.
    const [json, time] = await Promise.all([
      storage.get(AUTOSAVE_KEY),
      storage.get(AUTOSAVE_TIME_KEY),
    ]);
    if (!json) return null;
    return {
      json,
      timestamp: time ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/** Clear autosave. Fire-and-forget. */
export function clearAutosave(): void {
  void clearAutosaveAsync().catch(() => { /* ignore */ });
}

async function clearAutosaveAsync(): Promise<void> {
  await migrateAutosaveFromLocalStorage();
  const storage = getStorage();
  await Promise.all([
    storage.remove(AUTOSAVE_RECORD_KEY),
    storage.remove(AUTOSAVE_KEY),
    storage.remove(AUTOSAVE_TIME_KEY),
  ]);
}

export function resetAutosaveForTest(): void {
  _migrationAttempted = false;
  _recordMigrationAttempted = false;
}
