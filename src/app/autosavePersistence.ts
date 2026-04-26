import { getStorage } from '../core/storage/storage';

const AUTOSAVE_KEY = 'laserforge_autosave';
const AUTOSAVE_TIME_KEY = 'laserforge_autosave_time';

export interface AutosavePayload {
  json: string;
  timestamp: string;
}

let _migrationAttempted = false;

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
  const storage = getStorage();
  const timestamp = new Date().toISOString();
  await storage.set(AUTOSAVE_KEY, json);
  await storage.set(AUTOSAVE_TIME_KEY, timestamp);
}

/** Read autosave. Async. Returns null if none. */
export async function readAutosave(): Promise<AutosavePayload | null> {
  await migrateAutosaveFromLocalStorage();
  const storage = getStorage();
  try {
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
    storage.remove(AUTOSAVE_KEY),
    storage.remove(AUTOSAVE_TIME_KEY),
  ]);
}

export function resetAutosaveForTest(): void {
  _migrationAttempted = false;
}
