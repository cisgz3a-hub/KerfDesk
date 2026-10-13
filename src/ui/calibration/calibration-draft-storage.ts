type CalibrationDraftEnvelope<T extends object> = {
  readonly schemaVersion: 1;
  readonly draft: T;
};

export function restoreCalibrationDraft<T extends object>(
  key: string,
  fallback: T,
  fields: ReadonlyArray<keyof T>,
): T {
  const storage = safeLocalStorage();
  if (storage === null) return fallback;
  let raw: string | null = null;
  try {
    raw = storage.getItem(key);
  } catch {
    return fallback;
  }
  if (raw === null) return fallback;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isDraftEnvelope(parsed)) throw new Error('invalid calibration draft');
    return mergeDraft(fallback, parsed.draft, fields);
  } catch {
    clearDraft(storage, key);
    return fallback;
  }
}

export function persistCalibrationDraft<T extends object>(key: string, draft: T): boolean {
  const storage = safeLocalStorage();
  if (storage === null) return false;
  const envelope: CalibrationDraftEnvelope<T> = { schemaVersion: 1, draft };
  try {
    storage.setItem(key, JSON.stringify(envelope));
    return true;
  } catch {
    return false;
  }
}

function mergeDraft<T extends object>(
  fallback: T,
  stored: Record<string, unknown>,
  fields: ReadonlyArray<keyof T>,
): T {
  const next = { ...fallback } as { -readonly [K in keyof T]: T[K] };
  for (const field of fields) {
    const value = stored[String(field)];
    if (typeof value === 'string') next[field] = value as T[typeof field];
  }
  return next;
}

function isDraftEnvelope(
  value: unknown,
): value is CalibrationDraftEnvelope<Record<string, unknown>> {
  if (!isRecord(value)) return false;
  return value['schemaVersion'] === 1 && isRecord(value['draft']);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clearDraft(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Ignore storage cleanup failures; callers still get the safe fallback.
  }
}

function safeLocalStorage(): Storage | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage;
}

// Test settings as a file (LightBurn material-test presets): the same draft
// envelope with a kind, so a Material Test preset never loads into another
// calibration dialog. Unknown fields are ignored; missing ones keep defaults.
export function serializeCalibrationPreset<T extends object>(kind: string, draft: T): string {
  return `${JSON.stringify({ kind, schemaVersion: 1, draft }, null, 2)}\n`;
}

export function parseCalibrationPreset<T extends object>(
  kind: string,
  text: string,
  fallback: T,
  fields: ReadonlyArray<keyof T>,
): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('This is not a KerfDesk test preset file.');
  }
  if (!isDraftEnvelope(parsed) || (parsed as Record<string, unknown>)['kind'] !== kind) {
    throw new Error('This file holds settings for a different test.');
  }
  return mergeDraft(fallback, parsed.draft, fields);
}
