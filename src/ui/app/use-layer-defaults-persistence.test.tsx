import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import {
  layerDefaultsStorageKey,
  persistLayerDefaults,
  restoreLayerDefaults,
} from '../layers/layer-default-settings';
import {
  DEFAULT_LAYER_DEFAULTS_STATE,
  type LayerDefaultsState,
} from '../state/layer-default-actions';
import { useLayerDefaultsPersistence } from './use-layer-defaults-persistence';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function defaultsFixture(): LayerDefaultsState {
  return {
    byColor: { '#ff0000': { mode: 'fill', power: 42, speed: 1777 } },
    allColors: { mode: 'line', power: 30 },
  };
}

function HookProbe(): null {
  useLayerDefaultsPersistence();
  return null;
}

async function mountHook(): Promise<{ readonly unmount: () => Promise<void> }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(<HookProbe />);
  });
  return {
    unmount: async () => {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    },
  };
}

afterEach(() => {
  localStorage.clear();
  resetStore();
});

describe('useLayerDefaultsPersistence', () => {
  it('restores persisted defaults for the current device profile on mount', async () => {
    const deviceName = useStore.getState().project.device.name;
    persistLayerDefaults(localStorage, deviceName, defaultsFixture());

    const { unmount } = await mountHook();
    try {
      expect(useStore.getState().layerDefaults).toEqual(defaultsFixture());
    } finally {
      await unmount();
    }
  });

  it('persists layer-default changes after mount', async () => {
    const deviceName = useStore.getState().project.device.name;
    const { unmount } = await mountHook();
    try {
      await act(async () => {
        useStore.getState().setLayerDefaults(defaultsFixture());
      });

      expect(restoreLayerDefaults(localStorage, deviceName)).toEqual(defaultsFixture());
    } finally {
      await unmount();
    }
  });

  it('restores each selected profile before persisting further edits, including after remount', async () => {
    const profileA = useStore.getState().project.device;
    const profileB = { ...profileA, name: 'Other machine' };
    const defaultsA = { byColor: {}, allColors: { power: 23 } };
    const defaultsB = { byColor: {}, allColors: { power: 81 } };
    const editedB = { byColor: {}, allColors: { power: 67 } };
    persistLayerDefaults(localStorage, profileA.name, defaultsA);
    persistLayerDefaults(localStorage, profileB.name, defaultsB);

    const first = await mountHook();
    try {
      expect(useStore.getState().layerDefaults).toEqual(defaultsA);
      await act(async () => useStore.getState().replaceDeviceProfile(profileB));
      expect(useStore.getState().layerDefaults).toEqual(defaultsB);
      expect(restoreLayerDefaults(localStorage, profileB.name)).toEqual(defaultsB);
      await act(async () => useStore.getState().setLayerDefaults(editedB));
      await act(async () => useStore.getState().replaceDeviceProfile(profileA));
      expect(useStore.getState().layerDefaults).toEqual(defaultsA);
      expect(restoreLayerDefaults(localStorage, profileA.name)).toEqual(defaultsA);
      expect(restoreLayerDefaults(localStorage, profileB.name)).toEqual(editedB);
    } finally {
      await first.unmount();
    }

    resetStore();
    useStore.getState().replaceDeviceProfile(profileB);
    const second = await mountHook();
    try {
      expect(useStore.getState().layerDefaults).toEqual(editedB);
    } finally {
      await second.unmount();
    }
  });

  it.each(['missing', 'corrupt'] as const)(
    'clears the active defaults when the destination profile slot is %s',
    async (slot) => {
      const profileA = useStore.getState().project.device;
      const profileB = { ...profileA, name: 'Unconfigured machine' };
      persistLayerDefaults(localStorage, profileA.name, defaultsFixture());
      if (slot === 'corrupt') {
        localStorage.setItem(layerDefaultsStorageKey(profileB.name), '{not json');
      }
      const { unmount } = await mountHook();
      try {
        await act(async () => useStore.getState().replaceDeviceProfile(profileB));
        expect(useStore.getState().layerDefaults).toEqual(DEFAULT_LAYER_DEFAULTS_STATE);
        expect(localStorage.getItem(layerDefaultsStorageKey(profileB.name))).toBeNull();
        expect(restoreLayerDefaults(localStorage, profileA.name)).toEqual(defaultsFixture());
        await act(async () => useStore.getState().replaceDeviceProfile(profileA));
        expect(useStore.getState().layerDefaults).toEqual(defaultsFixture());
      } finally {
        await unmount();
      }
    },
  );
});
