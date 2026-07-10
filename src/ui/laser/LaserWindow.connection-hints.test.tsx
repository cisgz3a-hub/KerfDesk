// LaserWindow connection-hint copy (MCH-08). Lives in its own file because
// LaserWindow.test.tsx is at the 400-line cap. PROJECT.md mandates a Brave
// WebSerial caveat in the F-B1 connect error path; assert it renders when the
// browser reports no WebSerial support.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { useStore } from '../state';
import { LaserWindow } from './LaserWindow';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const unsupportedPlatform: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: async () => [],
  pickFileForSave: async () => null,
  serial: { isSupported: () => false, requestPort: async () => null },
};

afterEach(() => {
  useStore.getState().newProject();
});

describe('LaserWindow connection hints', () => {
  it('shows the Brave WebSerial caveat when the browser cannot connect', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(
          <PlatformProvider adapter={unsupportedPlatform}>
            <LaserWindow />
          </PlatformProvider>,
        );
      });

      expect(host.textContent).toContain('Brave');
      expect(host.textContent).toMatch(/Shields|flags/);
    } finally {
      if (root !== null) {
        await act(async () => root?.unmount());
      }
      host.remove();
    }
  });
});
