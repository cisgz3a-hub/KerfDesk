// useCncLibraryPersistence — wires the app-level CNC library (custom bits,
// feed presets, machine profiles — Phase H.7) to the React lifecycle,
// mounted once in App beside useMaterialLibraryPersistence. Restore on
// mount (never clobbering a session that already changed the library),
// auto-persist on every change, one warning per session on write failure.

import { useEffect } from 'react';
import { useStore } from '../state';
import {
  EMPTY_CNC_LIBRARY,
  persistCncLibrary,
  restoreCncLibrary,
} from '../state/cnc-library-persistence';
import { useToastStore } from '../state/toast-store';

export const CNC_LIBRARY_PERSIST_FAILURE_MESSAGE =
  'Your CNC bits/presets could not be saved for next session (storage is full or blocked).';

export function useCncLibraryPersistence(): void {
  const pushToast = useToastStore((state) => state.pushToast);
  useEffect(() => {
    const storage = window.localStorage;
    restoreOnMount(storage);

    let hasWarned = false;
    const unsubscribe = useStore.subscribe((state, prev) => {
      if (state.cncLibrary === prev.cncLibrary) return;
      if (!persistCncLibrary(storage, state.cncLibrary) && !hasWarned) {
        hasWarned = true;
        pushToast(CNC_LIBRARY_PERSIST_FAILURE_MESSAGE, 'warning');
      }
    });
    return unsubscribe;
  }, [pushToast]);
}

function restoreOnMount(storage: Storage): void {
  if (useStore.getState().cncLibrary !== EMPTY_CNC_LIBRARY) return;
  const restored = restoreCncLibrary(storage);
  if (restored === null) return;
  useStore.getState().setCncLibrary(restored);
}
