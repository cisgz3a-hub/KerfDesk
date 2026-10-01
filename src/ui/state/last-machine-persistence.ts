// ADR-500 Amendment 1: the last committed machine restores at startup.
// App-level state (not part of a project), stored
// as the same document as a machine profile export so it is validated on the
// way back in. Reads and writes fail soft: a quota, privacy or parse error only
// means startup keeps the generic starter and the banner offers Machine Setup.

import type { DeviceProfile } from '../../core/devices';
import { explicitMachineKindsForProfile } from '../../core/devices/device-profile';
import type { MachineKind } from '../../core/scene';
import {
  MACHINE_PROFILE_FORMAT,
  MACHINE_PROFILE_SCHEMA_VERSION,
  deserializeMachineProfileDocument,
  serializeMachineProfileDocument,
} from '../../io/machine-profile';

export const LAST_MACHINE_STORAGE_KEY = 'kerfdesk.last-machine.v1';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function rememberLastMachine(
  storage: StorageLike,
  profile: DeviceProfile,
  machineKind: MachineKind = 'laser',
): boolean {
  try {
    const text = serializeMachineProfileDocument({
      format: MACHINE_PROFILE_FORMAT,
      schemaVersion: MACHINE_PROFILE_SCHEMA_VERSION,
      profile,
      source: { kind: profile.profileSource ?? 'custom', label: profile.name },
      reviewNotes: [],
    });
    // The app-only mode is atomic with its validated profile. The unchanged
    // machine-profile parser ignores this additional field.
    const document: unknown = JSON.parse(text);
    storage.setItem(
      LAST_MACHINE_STORAGE_KEY,
      JSON.stringify({ ...(document as Record<string, unknown>), machineKind }),
    );
    return true;
  } catch {
    return false;
  }
}

export function loadLastMachine(storage: StorageLike): DeviceProfile | null {
  return loadLastMachineSelection(storage)?.profile ?? null;
}

export function loadLastMachineSelection(
  storage: StorageLike,
): { readonly profile: DeviceProfile; readonly machineKind: MachineKind } | null {
  let raw: string | null;
  try {
    raw = storage.getItem(LAST_MACHINE_STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  // A restore, not a file import: the machine was saved here from Machine Setup,
  // so its scan offsets keep the calibration status they were saved with.
  const result = deserializeMachineProfileDocument(raw, 'restore');
  if (result.kind !== 'ok') return null;
  const profile = result.document.profile;
  const storedKind: unknown = (JSON.parse(raw) as Record<string, unknown>)['machineKind'];
  const kinds = explicitMachineKindsForProfile(profile);
  const machineKind =
    storedKind === 'laser' || storedKind === 'cnc'
      ? storedKind
      : kinds.length === 1 && kinds[0] === 'cnc'
        ? 'cnc'
        : 'laser';
  return { profile, machineKind };
}
