import { act } from 'react';
import { createProject } from '../../core/scene';
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
      expect(useStore.getState().layerDefaults).toEqual({
        ...defaultsFixture(),
        applyToNewOperations: false,
      });
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
      expect(useStore.getState().layerDefaults).toEqual({
        ...defaultsA,
        applyToNewOperations: false,
      });
      await act(async () => useStore.getState().replaceDeviceProfile(profileB));
      expect(useStore.getState().layerDefaults).toEqual({
        ...defaultsB,
        applyToNewOperations: false,
      });
      expect(restoreLayerDefaults(localStorage, profileB.name)).toEqual(defaultsB);
      await act(async () => useStore.getState().setLayerDefaults(editedB));
      await act(async () => useStore.getState().replaceDeviceProfile(profileA));
      expect(useStore.getState().layerDefaults).toEqual({
        ...defaultsA,
        applyToNewOperations: false,
      });
      expect(restoreLayerDefaults(localStorage, profileA.name)).toEqual(defaultsA);
      expect(restoreLayerDefaults(localStorage, profileB.name)).toEqual(editedB);
    } finally {
      await first.unmount();
    }

    resetStore();
    useStore.getState().replaceDeviceProfile(profileB);
    const second = await mountHook();
    try {
      expect(useStore.getState().layerDefaults).toEqual({
        ...editedB,
        applyToNewOperations: false,
      });
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
        expect(useStore.getState().layerDefaults).toEqual({
          ...DEFAULT_LAYER_DEFAULTS_STATE,
          applyToNewOperations: false,
        });
        expect(localStorage.getItem(layerDefaultsStorageKey(profileB.name))).toBeNull();
        expect(restoreLayerDefaults(localStorage, profileA.name)).toEqual(defaultsFixture());
        await act(async () => useStore.getState().replaceDeviceProfile(profileA));
        expect(useStore.getState().layerDefaults).toEqual({
          ...defaultsFixture(),
          applyToNewOperations: false,
        });
      } finally {
        await unmount();
      }
    },
  );

  it('opens a saved machine from an empty source without deleting the destination presets', async () => {
    const profileA = useStore.getState().project.device;
    const profileB = { ...profileA, name: 'Saved project machine' };
    persistLayerDefaults(localStorage, profileB.name, defaultsFixture());
    const savedSlot = localStorage.getItem(layerDefaultsStorageKey(profileB.name));
    const { unmount } = await mountHook();
    try {
      expect(useStore.getState().layerDefaults.allColors).toBeNull();
      await act(async () => useStore.getState().setProject(createProject(profileB)));
      expect(useStore.getState().layerDefaults).toEqual({
        ...defaultsFixture(),
        applyToNewOperations: false,
      });
      expect(localStorage.getItem(layerDefaultsStorageKey(profileB.name))).toBe(savedSlot);
      expect(localStorage.getItem(layerDefaultsStorageKey(profileA.name))).toBeNull();
    } finally {
      await unmount();
    }
  });

  it.each(['new', 'open'] as const)(
    '%s ends automatic reuse while keeping saved presets available for explicit reuse',
    async (replacement) => {
      const device = useStore.getState().project.device;
      const { unmount } = await mountHook();
      try {
        await act(async () => {
          useStore
            .getState()
            .setLayerDefaults({ ...defaultsFixture(), applyToNewOperations: true });
        });
        const savedSlot = localStorage.getItem(layerDefaultsStorageKey(device.name));
        expect(useStore.getState().layerDefaults.applyToNewOperations).toBe(true);
        await act(async () => {
          if (replacement === 'new') useStore.getState().newProject();
          else useStore.getState().setProject(createProject(device));
        });
        expect(useStore.getState().layerDefaults).toEqual({
          ...defaultsFixture(),
          applyToNewOperations: false,
        });
        expect(restoreLayerDefaults(localStorage, device.name)).toEqual(defaultsFixture());
        expect(localStorage.getItem(layerDefaultsStorageKey(device.name))).toBe(savedSlot);
        expect(useStore.getState().dirty).toBe(false);
      } finally {
        await unmount();
      }
    },
  );
});
