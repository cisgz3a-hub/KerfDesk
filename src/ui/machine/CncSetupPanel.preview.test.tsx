import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { CncSetupPanel } from './CncSetupPanel';

vi.mock('../cnc-viewer3d/bit-preview-three-scene', () => ({
  createBitPreviewThreeScene: vi.fn(async () => ({
    kind: 'no-webgl',
    reason: 'WebGL intentionally unavailable in this component test.',
  })),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mockPlatform: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: async () => [],
  pickFileForSave: async () => null,
  serial: { isSupported: () => false, requestPort: async () => null },
};

afterEach(() => resetStore());

async function render(): Promise<{ readonly host: HTMLDivElement; readonly root: Root }> {
  useStore.getState().setMachineKind('cnc');
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <PlatformProvider adapter={mockPlatform}>
        <CncSetupPanel />
      </PlatformProvider>,
    );
  });
  return { host, root };
}

describe('CncSetupPanel bit preview', () => {
  it('briefly previews the modeled envelope after the active bit changes', async () => {
    const { host, root } = await render();
    try {
      const select = host.querySelector('select[aria-label="Active bit"]');
      if (!(select instanceof HTMLSelectElement)) throw new Error('active bit select missing');
      select.value = 'vb-90-6350-hobby';
      await act(async () => Simulate.change(select));

      const machine = useStore.getState().project.machine;
      expect(machine?.kind === 'cnc' ? machine.toolId : undefined).toBe('vb-90-6350-hobby');
      expect(host.textContent).toContain('Modeled cutting envelope');
      expect(host.textContent).toContain('90° V-bit — 6.35 mm (1/4") cut, 3.175 mm (1/8") shank');
      expect(host.textContent).toContain('Catalog shank: 3.175 mm (metadata only');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
