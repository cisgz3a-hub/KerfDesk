// Cross-session record of which machine-profile signatures the operator has run
// through the Device Setup wizard (FU-4). Drives only the passive "set up this
// machine" nudge — it never auto-opens anything. App-level state (not part of
// the .lf2 project), so it lives in localStorage beside the other app slots.
// Storage is injected so the logic is testable without globals; reads/writes
// fail soft (return empty / false) so a quota or parse error never breaks a
// mutation, matching the material-library persistence posture.

export const DEVICE_SETUP_CONFIGURED_STORAGE_KEY = 'laserforge.device-setup.configured.v1';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function browserLocalStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function loadConfiguredSignatures(storage: StorageLike): ReadonlySet<string> {
  let raw: string | null;
  try {
    raw = storage.getItem(DEVICE_SETUP_CONFIGURED_STORAGE_KEY);
  } catch {
    return new Set();
  }
  if (raw === null) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value): value is string => typeof value === 'string'));
  } catch {
    return new Set();
  }
}

export function persistConfiguredSignatures(
  storage: StorageLike,
  signatures: ReadonlySet<string>,
): boolean {
  try {
    storage.setItem(DEVICE_SETUP_CONFIGURED_STORAGE_KEY, JSON.stringify([...signatures]));
    return true;
  } catch {
    return false;
  }
}
