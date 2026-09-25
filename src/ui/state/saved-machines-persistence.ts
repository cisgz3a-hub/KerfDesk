// Workstation persistence for My machines (ADR-374). The list is app-level
// state, deliberately not part of any .lf2 project, so it lives in this
// browser profile's localStorage beside the material libraries.
//
// Unlike the material-library slot, an unreadable list is never cleared: the
// raw text is first copied to a backup key, because a machine profile carries
// hours of calibration (scan offsets, camera alignment) the operator cannot
// re-create from memory.

import {
  EMPTY_SAVED_MACHINE_LIST,
  type SavedMachineList,
} from '../../core/saved-machines/saved-machine-list';
import {
  deserializeSavedMachineList,
  serializeSavedMachineList,
} from '../../io/saved-machines/saved-machine-list-io';

export const SAVED_MACHINES_STORAGE_KEY = 'laserforge.saved-machines.v1';
export const SAVED_MACHINES_BACKUP_KEY = 'laserforge.saved-machines.v1.unreadable';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function restoreSavedMachineList(storage: StorageLike): SavedMachineList {
  let raw: string | null;
  try {
    raw = storage.getItem(SAVED_MACHINES_STORAGE_KEY);
  } catch {
    return EMPTY_SAVED_MACHINE_LIST;
  }
  if (raw === null) return EMPTY_SAVED_MACHINE_LIST;
  const result = deserializeSavedMachineList(raw);
  if (result.kind === 'invalid' || result.droppedEntries > 0) backUpUnreadable(storage, raw);
  return result.kind === 'ok' ? result.list : EMPTY_SAVED_MACHINE_LIST;
}

/** False instead of throwing, so a full or blocked storage cannot break the
 * action that changed the list; the caller tells the operator. */
export function persistSavedMachineList(storage: StorageLike, list: SavedMachineList): boolean {
  try {
    storage.setItem(SAVED_MACHINES_STORAGE_KEY, serializeSavedMachineList(list));
    return true;
  } catch {
    return false;
  }
}

function backUpUnreadable(storage: StorageLike, raw: string): void {
  try {
    storage.setItem(SAVED_MACHINES_BACKUP_KEY, raw);
  } catch {
    // Nothing more can be kept; the readable entries still load.
  }
}
