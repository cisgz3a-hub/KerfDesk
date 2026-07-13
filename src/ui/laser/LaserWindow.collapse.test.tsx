import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { createStreamer, step } from '../../core/controllers/grbl';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { useLaserStore } from '../state/laser-store';
import { useUiStore } from '../state/ui-store';
import { LaserWindow } from './LaserWindow';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mockPlatform: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: async () => [],
  pickFileForSave: async () => null,
  serial: { isSupported: () => true, requestPort: async () => null },
};

afterEach(() => {
  useUiStore.getState().setRailPanelVisible('machine', true);
  useLaserStore.setState({ connection: { kind: 'disconnected' }, streamer: null });
});

describe('LaserWindow panel visibility', () => {
  it('collapses when idle and expands from the narrow machine strip', async () => {
    useUiStore.getState().setRailPanelVisible('machine', false);
    const view = await renderLaserWindow();
    try {
      expect(
        view.host.querySelector('aside[aria-label="Laser controls collapsed"]'),
      ).not.toBeNull();
      const expand = requiredButton(view.host, 'Expand Laser panel');
      await act(async () => expand.click());
      expect(view.host.querySelector('aside[aria-label="Laser controls"]')).not.toBeNull();
    } finally {
      await view.unmount();
    }
  });

  it('forces machine controls visible while a job is active', async () => {
    useUiStore.getState().setRailPanelVisible('machine', false);
    useLaserStore.setState({
      connection: { kind: 'connected' },
      streamer: step(createStreamer('G1 X1 S100')).state,
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    const view = await renderLaserWindow();
    try {
      expect(view.host.querySelector('aside[aria-label="Laser controls"]')).not.toBeNull();
      const collapse = requiredButton(view.host, 'Collapse Laser panel');
      expect(collapse.disabled).toBe(true);
      expect(collapse.title).toContain('Stop remains reachable');
    } finally {
      await view.unmount();
    }
  });
});

async function renderLaserWindow(): Promise<{
  readonly host: HTMLDivElement;
  readonly unmount: () => Promise<void>;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(
      <PlatformProvider adapter={mockPlatform}>
        <LaserWindow />
      </PlatformProvider>,
    );
  });
  return {
    host,
    unmount: async () => {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    },
  };
}

function requiredButton(host: HTMLElement, label: string): HTMLButtonElement {
  const button = host.querySelector(`button[aria-label="${label}"]`);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Button not rendered: ${label}`);
  return button;
}
