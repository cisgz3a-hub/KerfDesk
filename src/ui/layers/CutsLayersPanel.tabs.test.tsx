import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { useStore } from '../state';
import { resetStore, svgObj } from '../state/test-helpers';
import { useUiStore } from '../state/ui-store';
import { CutsLayersPanel } from './CutsLayersPanel';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mockPlatform: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: async () => [],
  pickFileForSave: async () => null,
  serial: {
    isSupported: () => false,
    requestPort: async () => null,
  },
};

async function renderPanel(): Promise<{
  readonly host: HTMLDivElement;
  readonly root: Root;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(
      <PlatformProvider adapter={mockPlatform}>
        <CutsLayersPanel />
      </PlatformProvider>,
    );
  });
  if (root === null) throw new Error('root missing');
  return { host, root };
}

afterEach(() => {
  document.body.innerHTML = '';
  resetStore();
  useUiStore.getState().setRailPanelVisible('layers', true);
  useUiStore.getState().setCutsLayersView('layers');
});

describe('CutsLayersPanel tabs', () => {
  it('keeps material management out of the default layer workflow', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#000000']));
    useStore.getState().selectObject('O1');
    const { host, root } = await renderPanel();
    try {
      expect(host.querySelector('[aria-label="Selected object properties"]')).not.toBeNull();
      expect(host.querySelector('section[aria-label="Material Library"]')).toBeNull();

      const layersTab = host.querySelector('button[role="tab"]#cuts-layers-layers-tab');
      const runOrderTab = host.querySelector('button[role="tab"]#cuts-layers-run-order-tab');
      const materialsTab = host.querySelector('button[role="tab"]#cuts-layers-materials-tab');
      if (!(layersTab instanceof HTMLButtonElement)) throw new Error('layers tab missing');
      if (!(runOrderTab instanceof HTMLButtonElement)) throw new Error('run order tab missing');
      if (!(materialsTab instanceof HTMLButtonElement)) throw new Error('materials tab missing');
      expect(layersTab.getAttribute('aria-selected')).toBe('true');
      expect(runOrderTab.getAttribute('aria-selected')).toBe('false');
      expect(materialsTab.getAttribute('aria-selected')).toBe('false');

      await act(async () => materialsTab.click());

      expect(materialsTab.getAttribute('aria-selected')).toBe('true');
      expect(host.querySelector('section[aria-label="Material Library"]')).not.toBeNull();
      expect(host.querySelector('[aria-label="Selected object properties"]')).toBeNull();
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('hides Materials in CNC mode even when it was the last selected view', async () => {
    useUiStore.getState().setCutsLayersView('materials');
    useStore.getState().setMachineKind('cnc');
    const { host, root } = await renderPanel();
    try {
      expect(
        host.querySelector('[role="tablist"][aria-label="Artwork panel view"]'),
      ).not.toBeNull();
      expect(host.querySelector('#cuts-layers-run-order-tab')).not.toBeNull();
      expect(host.querySelector('#cuts-layers-materials-tab')).toBeNull();
      expect(host.querySelector('section[aria-label="Material Library"]')).toBeNull();
      expect(host.textContent).toContain('Import or draw artwork to create its first operation.');
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('opens the numeric run-order manager for laser and CNC projects', async () => {
    useStore.getState().importSvgObject(svgObj('Johann', ['#000000']));
    const { host, root } = await renderPanel();
    try {
      const runOrderTab = host.querySelector('button#cuts-layers-run-order-tab');
      if (!(runOrderTab instanceof HTMLButtonElement)) throw new Error('run order tab missing');
      await act(async () => runOrderTab.click());

      expect(host.querySelector('[aria-label="Artwork run order tools"]')).not.toBeNull();
      expect(host.querySelector('input[aria-label="Run position for Johann"]')).not.toBeNull();
      expect(host.textContent).not.toContain('Earlier');
      expect(host.textContent).not.toContain('Later');
    } finally {
      await act(async () => root.unmount());
    }
  });
});
