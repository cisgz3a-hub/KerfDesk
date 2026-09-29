// A reload of the same tab (F5, a crash reload, a restored tab) keeps the
// autosave session ID, because it lives in sessionStorage. The new page can
// therefore inherit a slot that still holds the previous page's unsaved work.
// Recovery offers that work, but the new page's first interval write or
// manual-save cleanup would replace it. These checks tell the durable service
// whether the inherited slot holds such work, so it can move to a fresh slot.
//
// Only snapshots this build could write over count. Unreadable bytes hold
// nothing to recover, and recovery retires them. A newer app version is
// already refused by every write and clear, and the first write moves the
// page to a fresh slot on its own.

import type { AutosaveDurableRepository } from './autosave-durable-repository';
import { isAutosaveRecord, requireSupportedAutosaveVersion } from './autosave-record';

export function localSlotHoldsReplaceableSnapshot(storageKey: string): boolean {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw === null) return false;
    const value: unknown = JSON.parse(raw);
    if (!isAutosaveRecord(value)) return false;
    requireSupportedAutosaveVersion(value);
    return true;
  } catch {
    // Blocked storage, unparseable bytes, or a newer version (see above).
    return false;
  }
}

export async function durableSlotHoldsReplaceableSnapshot(
  repository: AutosaveDurableRepository,
  storageKey: string,
): Promise<boolean> {
  try {
    return await repository.holdsReplaceableSnapshot(storageKey);
  } catch {
    // Storage that cannot be read cannot show the slot is empty. Moving to a
    // fresh slot loses nothing, so that is the safe answer.
    return true;
  }
}
