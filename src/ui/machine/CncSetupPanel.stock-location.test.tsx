import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { CncSetupPanel } from './CncSetupPanel';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mockPlatform: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: async () => [],
  pickFileForSave: async () => null,
  serial: { isSupported: () => false, requestPort: async () => null },
};

let host: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  host = null;
  root = null;
  resetStore();
});

describe('CncSetupPanel stock location', () => {
  it('leaves stock dimensions to the canvas HUD instead of duplicating them in the rail', async () => {
    useStore.getState().setMachineKind('cnc');
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <PlatformProvider adapter={mockPlatform}>
          <CncSetupPanel />
        </PlatformProvider>,
      );
    });

    for (const label of [
      'Stock thickness',
      'Stock width',
      'Stock height',
      'Stock origin X',
      'Stock origin Y',
    ]) {
      expect(host.querySelector(`input[aria-label="${label}"]`)).toBeNull();
    }
    expect(host.textContent).toContain('Spindle');
    expect(host.textContent).toContain('Motion');
  });
});
