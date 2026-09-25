// My machines (ADR-374): the workstation's saved machine list. Separate from
// the project store on purpose: a project keeps its own complete machine
// profile, and changing this list never edits an open project by itself.

import { create } from 'zustand';
import {
  EMPTY_SAVED_MACHINE_LIST,
  type SavedMachineList,
} from '../../core/saved-machines/saved-machine-list';
import { browserLocalStorage } from './browser-local-storage';
import {
  SAVED_MACHINES_STORAGE_KEY,
  persistSavedMachineList,
  restoreSavedMachineList,
} from './saved-machines-persistence';

type SavedMachinesStore = {
  readonly list: SavedMachineList;
  /** True when the last change could not be written to this workstation. */
  readonly persistFailed: boolean;
  /** Replace the list and write it through; false when it could not be stored. */
  readonly commit: (list: SavedMachineList) => boolean;
  /** Re-read the stored list, e.g. after another window changed it. */
  readonly reload: () => void;
};

export const useSavedMachinesStore = create<SavedMachinesStore>((set) => ({
  list: storedList(),
  persistFailed: false,
  commit: (list) => {
    const storage = browserLocalStorage();
    const stored = storage !== null && persistSavedMachineList(storage, list);
    set({ list, persistFailed: !stored });
    return stored;
  },
  reload: () => set({ list: storedList() }),
}));

function storedList(): SavedMachineList {
  const storage = browserLocalStorage();
  return storage === null ? EMPTY_SAVED_MACHINE_LIST : restoreSavedMachineList(storage);
}

// Another KerfDesk window on this workstation shares the slot. Reload when it
// writes, so this window's next change cannot overwrite a machine saved there.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === SAVED_MACHINES_STORAGE_KEY) useSavedMachinesStore.getState().reload();
  });
}
