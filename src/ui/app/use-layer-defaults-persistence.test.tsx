import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { persistLayerDefaults, restoreLayerDefaults } from '../layers/layer-default-settings';
import type { LayerDefaultsState } from '../state/layer-default-actions';
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
});
