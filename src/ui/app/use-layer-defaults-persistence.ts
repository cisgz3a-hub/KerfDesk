import { useEffect } from 'react';
import {
  layerDefaultsStorageKey,
  persistLayerDefaults,
  restoreLayerDefaults,
} from '../layers/layer-default-settings';
import { useStore } from '../state';
import { browserLocalStorage } from '../state/browser-local-storage';
import { DEFAULT_LAYER_DEFAULTS_STATE } from '../state/layer-default-actions';
import { useToastStore } from '../state/toast-store';

export const LAYER_DEFAULTS_PERSIST_FAILURE_MESSAGE =
  'Layer defaults could not be remembered for next session.';

export function useLayerDefaultsPersistence(): void {
  const pushToast = useToastStore((state) => state.pushToast);
  useEffect(() => {
    const storage = browserLocalStorage();
    const restored =
      storage === null
        ? null
        : restoreLayerDefaults(storage, useStore.getState().project.device.name);
    if (restored !== null) useStore.getState().setLayerDefaults(restored);

    let hasWarned = false;
    let restoringProfile = false;
    const unsubscribe = useStore.subscribe((state, prev) => {
      if (restoringProfile) return;
      if (
        layerDefaultsStorageKey(state.project.device.name) !==
        layerDefaultsStorageKey(prev.project.device.name)
      ) {
        const nextDefaults =
          storage === null ? null : restoreLayerDefaults(storage, state.project.device.name);
        // A profile change selects its defaults; it must never save the previous
        // profile's still-active values into the destination slot.
        restoringProfile = true;
        try {
          useStore.getState().setLayerDefaults(nextDefaults ?? DEFAULT_LAYER_DEFAULTS_STATE);
        } finally {
          restoringProfile = false;
        }
        return;
      }
      if (state.layerDefaults === prev.layerDefaults) return;
      const persisted =
        storage !== null &&
        persistLayerDefaults(storage, state.project.device.name, state.layerDefaults);
      if (!persisted && !hasWarned) {
        hasWarned = true;
        pushToast(LAYER_DEFAULTS_PERSIST_FAILURE_MESSAGE, 'warning');
      }
    });
    return unsubscribe;
  }, [pushToast]);
}
