// useMaterialLibraryPersistence — wires material-library-persistence to the
// React lifecycle (mounted once in App, beside useAutosave).
//
//   * On mount: restores the persisted library if no library is loaded yet
//     (a library the user already loaded this session is never clobbered),
//     including its dirty-to-file marker.
//   * Afterwards: writes through to localStorage whenever the library slice
//     changes (New/Load/Unload/Create preset/Assign/Save marking it clean).
//     A failed write warns once per session instead of breaking the edit.

import { useEffect } from 'react';
import { useStore } from '../state';
import {
  persistMaterialLibrary,
  restoreMaterialLibrary,
} from '../state/material-library-persistence';
import { useToastStore } from '../state/toast-store';

export const MATERIAL_LIBRARY_PERSIST_FAILURE_MESSAGE =
  'The material library could not be remembered for next session. Use Save... to keep it as a file.';

export function useMaterialLibraryPersistence(): void {
  const pushToast = useToastStore((state) => state.pushToast);
  useEffect(() => {
    const storage = window.localStorage;

    if (useStore.getState().materialLibrary === null) {
      const restored = restoreMaterialLibrary(storage);
      if (restored !== null) {
        useStore.getState().setMaterialLibrary(restored.library);
        // setMaterialLibrary marks the library clean; re-apply the persisted
        // dirty marker so the unsaved-to-file asterisk survives a reload.
        if (restored.dirty) useStore.setState({ materialLibraryDirty: true });
      }
    }

    let hasWarned = false;
    const unsubscribe = useStore.subscribe((state, prev) => {
      if (
        state.materialLibrary === prev.materialLibrary &&
        state.materialLibraryDirty === prev.materialLibraryDirty
      ) {
        return;
      }
      const persisted = persistMaterialLibrary(
        storage,
        state.materialLibrary,
        state.materialLibraryDirty,
      );
      if (!persisted && !hasWarned) {
        hasWarned = true;
        pushToast(MATERIAL_LIBRARY_PERSIST_FAILURE_MESSAGE, 'warning');
      }
    });
    return unsubscribe;
  }, [pushToast]);
}
