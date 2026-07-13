import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useUiStore } from '../state/ui-store';
import { COMPACT_RAIL_QUERY, useCompactRailDefaults } from './use-compact-rail-defaults';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  useUiStore.getState().setRailPanelVisible('layers', true);
  useUiStore.getState().setRailPanelVisible('machine', true);
  vi.unstubAllGlobals();
});

describe('useCompactRailDefaults', () => {
  it('starts compact layouts collapsed but allows a rail to be reopened', async () => {
    const media = fakeMediaQuery(true);
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => media.query),
    );
    const view = await renderProbe();
    try {
      expect(window.matchMedia).toHaveBeenCalledWith(COMPACT_RAIL_QUERY);
      expect(useUiStore.getState().railPanelVisibility).toEqual({
        layers: false,
        machine: false,
      });

      act(() => useUiStore.getState().setRailPanelVisible('layers', true));
      expect(useUiStore.getState().railPanelVisibility.layers).toBe(true);
    } finally {
      await view.unmount();
    }
  });

  it('collapses the rails each time the viewport enters compact mode', async () => {
    const media = fakeMediaQuery(false);
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => media.query),
    );
    const view = await renderProbe();
    try {
      expect(useUiStore.getState().railPanelVisibility).toEqual({ layers: true, machine: true });
      act(() => media.emit(true));
      expect(useUiStore.getState().railPanelVisibility).toEqual({
        layers: false,
        machine: false,
      });
    } finally {
      await view.unmount();
    }
  });
});

function Probe(): null {
  useCompactRailDefaults();
  return null;
}

async function renderProbe(): Promise<{ readonly unmount: () => Promise<void> }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(<Probe />);
  });
  return {
    unmount: async () => {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    },
  };
}

function fakeMediaQuery(initial: boolean): {
  readonly query: MediaQueryList;
  readonly emit: (matches: boolean) => void;
} {
  let listener: ((event: MediaQueryListEvent) => void) | null = null;
  const query = {
    matches: initial,
    media: COMPACT_RAIL_QUERY,
    onchange: null,
    addEventListener: (_type: string, next: (event: MediaQueryListEvent) => void) => {
      listener = next;
    },
    removeEventListener: () => {
      listener = null;
    },
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => true,
  } as MediaQueryList;
  return {
    query,
    emit: (matches) => listener?.({ matches } as MediaQueryListEvent),
  };
}
