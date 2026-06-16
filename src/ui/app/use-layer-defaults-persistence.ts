import { useEffect } from 'react';
import { persistLayerDefaults, restoreLayerDefaults } from '../layers/layer-default-settings';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';

export const LAYER_DEFAULTS_PERSIST_FAILURE_MESSAGE =
  'Layer defaults could not be remembered for next session.';

export function useLayerDefaultsPersistence(): void {
  const pushToast = useToastStore((state) => state.pushToast);
  useEffect(() => {
    const storage = window.localStorage;
    const restored = restoreLayerDefaults(storage, useStore.getState().project.device.name);
    if (restored !== null) useStore.getState().setLayerDefaults(restored);

    let hasWarned = false;
    const unsubscribe = useStore.subscribe((state, prev) => {
      if (
        state.layerDefaults === prev.layerDefaults &&
        state.project.device.name === prev.project.device.name
      ) {
        return;
      }
      const persisted = persistLayerDefaults(
        storage,
        state.project.device.name,
        state.layerDefaults,
      );
      if (!persisted && !hasWarned) {
        hasWarned = true;
        pushToast(LAYER_DEFAULTS_PERSIST_FAILURE_MESSAGE, 'warning');
      }
    });
    return unsubscribe;
  }, [pushToast]);
}
