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

import { useEffect } from 'react';
import { useStore } from '../state';
import {
  collectionChanged,
  isEmptyCollection,
  libraryDocument,
  reconcileActiveDocument,
} from '../state/material-library-collection';
import {
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
    const storage = window.localStorage;
    restoreOnMount(storage);

    let hasWarned = false;
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
      if (!persistCollection(storage, state.savedLibraries) && !hasWarned) {
        hasWarned = true;
        pushToast(MATERIAL_LIBRARY_PERSIST_FAILURE_MESSAGE, 'warning');
      }
    });
    return unsubscribe;
  }, [pushToast]);
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
