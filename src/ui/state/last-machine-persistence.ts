// ADR-500: the last machine Machine Setup saved, kept across sessions so a new
// session can offer it back instead of starting silently on the generic
// 400 × 400 mm starter machine. App-level state (not part of a project), stored
// as the same document as a machine profile export so it is validated on the
// way back in. Reads and writes fail soft: a quota, privacy or parse error only
// means the banner cannot offer the machine.

import type { DeviceProfile } from '../../core/devices';
import {
  MACHINE_PROFILE_FORMAT,
  MACHINE_PROFILE_SCHEMA_VERSION,
  deserializeMachineProfileDocument,
  serializeMachineProfileDocument,
} from '../../io/machine-profile';

export const LAST_MACHINE_STORAGE_KEY = 'kerfdesk.last-machine.v1';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function rememberLastMachine(storage: StorageLike, profile: DeviceProfile): boolean {
  try {
    const text = serializeMachineProfileDocument({
      format: MACHINE_PROFILE_FORMAT,
      schemaVersion: MACHINE_PROFILE_SCHEMA_VERSION,
      profile,
      source: { kind: profile.profileSource ?? 'custom', label: profile.name },
      reviewNotes: [],
    });
    storage.setItem(LAST_MACHINE_STORAGE_KEY, text);
    return true;
  } catch {
    return false;
  }
}

export function loadLastMachine(storage: StorageLike): DeviceProfile | null {
  let raw: string | null;
  try {
    raw = storage.getItem(LAST_MACHINE_STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  const result = deserializeMachineProfileDocument(raw);
  return result.kind === 'ok' ? result.document.profile : null;
}
