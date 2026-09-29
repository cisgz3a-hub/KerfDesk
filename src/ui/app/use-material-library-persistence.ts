// useMaterialLibraryPersistence — wires the in-app multi-library collection
// (ADR-093) to the React lifecycle (mounted once in App, beside useAutosave).
//
//   * On mount: if nothing is loaded yet, restore the saved collection — or
//     migrate the legacy single-library slot into it once — and re-open its
//     active library. A library already loaded this session is never clobbered.
//   * Afterwards: every change reconciles the live active document back into the
//     collection (so its edits are captured and no other library is dropped) and
//     auto-saves it to localStorage. There is no manual Save; a failed write
//     warns once per session instead of breaking the edit (F-ML3).
//   * When another window saves the collection, this window takes the saved copy
//     (like the Console user macros), so its next save keeps that window's edits
//     instead of overwriting them with a stale copy.

import { useEffect } from 'react';
import { useStore } from '../state';
import { browserLocalStorage } from '../state/browser-local-storage';
import {
  collectionChanged,
  isEmptyCollection,
  libraryDocument,
  parseCollection,
  reconcileActiveDocument,
  type MaterialLibraryCollection,
} from '../state/material-library-collection';
import {
  MATERIAL_LIBRARIES_STORAGE_KEY,
  migrateLegacyLibrary,
  persistCollection,
  restoreCollection,
} from '../state/material-library-persistence';
import { useToastStore } from '../state/toast-store';

export const MATERIAL_LIBRARY_PERSIST_FAILURE_MESSAGE =
  'Your material libraries could not be saved for next session. Use Export... to keep one as a file.';

export function useMaterialLibraryPersistence(): void {
  const pushToast = useToastStore((state) => state.pushToast);
  useEffect(() => {
    const storage = browserLocalStorage();
    if (storage !== null) restoreOnMount(storage);

    let hasWarned = false;
    let adoptingStoredCopy = false;
    const unsubscribe = useStore.subscribe((state, prev) => {
      if (
        state.materialLibrary === prev.materialLibrary &&
        state.savedLibraries === prev.savedLibraries
      ) {
        return;
      }
      const reconciled = reconcileActiveDocument(
        state.savedLibraries,
        state.materialLibrary,
        Date.now(),
      );
      if (collectionChanged(state.savedLibraries, reconciled)) {
        // Fold the live document in; the resulting savedLibraries change
        // re-enters this subscriber, which then persists the settled collection.
        useStore.setState({ savedLibraries: reconciled });
        return;
      }
      // The adopted copy is already saved. Writing this window's view of it
      // back would make two windows with different open libraries trade
      // writes forever.
      if (adoptingStoredCopy) return;
      if ((storage === null || !persistCollection(storage, state.savedLibraries)) && !hasWarned) {
        hasWarned = true;
        pushToast(MATERIAL_LIBRARY_PERSIST_FAILURE_MESSAGE, 'warning');
      }
    });
    // The browser sends 'storage' only to the other windows of the app.
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== MATERIAL_LIBRARIES_STORAGE_KEY && event.key !== null) return;
      const stored = storage === null ? null : readStoredCollection(storage);
      if (stored === null) return;
      adoptingStoredCopy = true;
      try {
        adoptStoredCollection(stored);
      } finally {
        adoptingStoredCopy = false;
      }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      unsubscribe();
      window.removeEventListener('storage', onStorage);
    };
  }, [pushToast]);
}

// No clearing of a corrupt or missing slot here, unlike restoreCollection: a
// reload must not write, and this window keeps its libraries until it next saves.
function readStoredCollection(storage: Storage): MaterialLibraryCollection | null {
  try {
    const raw = storage.getItem(MATERIAL_LIBRARIES_STORAGE_KEY);
    return raw === null ? null : parseCollection(raw);
  } catch {
    return null;
  }
}

// This window keeps its own open library, refreshed to the saved version of it.
// If another window deleted that library, this window keeps it open rather
// than drop the last copy; its next save stores it again.
function adoptStoredCollection(stored: MaterialLibraryCollection): void {
  const open = useStore.getState().materialLibrary;
  const refreshed = open === null ? null : libraryDocument(stored, open.libraryId);
  useStore.setState({
    savedLibraries: stored,
    ...(refreshed !== null ? { materialLibrary: refreshed } : {}),
  });
}

function restoreOnMount(storage: Storage): void {
  const state = useStore.getState();
  if (state.materialLibrary !== null || !isEmptyCollection(state.savedLibraries)) return;

  const restored = restoreCollection(storage) ?? migrateLegacyLibrary(storage, Date.now());
  if (restored === null) return;

  const activeDoc =
    restored.activeLibraryId === null ? null : libraryDocument(restored, restored.activeLibraryId);
  useStore.setState({
    savedLibraries: restored,
    ...(activeDoc !== null ? { materialLibrary: activeDoc } : {}),
  });
}
