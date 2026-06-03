import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { createProject } from '../../core/scene';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { LaserWindow } from './LaserWindow';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mockPlatform: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: async () => [],
  pickFileForSave: async () => null,
  serial: {
    isSupported: () => true,
    requestPort: async () => null,
  },
};

afterEach(() => {
  useStore.getState().newProject();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    autofocusBusy: false,
    streamer: null,
    workOriginActive: false,
    wcoCache: null,
  });
});

describe('LaserWindow autofocus busy controls', () => {
  it('disables motion, origin, and disconnect controls while autofocus is active', async () => {
    useStore.setState({
      project: createProject({
        ...DEFAULT_DEVICE_PROFILE,
        homing: { enabled: true, direction: 'front-left' },
        autofocusCommand: '$HZ1',
      }),
    });
    useLaserStore.setState({
      connection: { kind: 'connected' },
      autofocusBusy: true,
      streamer: null,
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(
          <PlatformProvider adapter={mockPlatform}>
            <LaserWindow />
          </PlatformProvider>,
        );
      });

      expect(button(host, 'Disconnect').disabled).toBe(true);
      expect(button(host, 'Home').disabled).toBe(true);
      expect(button(host, 'Auto-focus').disabled).toBe(true);
      expect(button(host, 'Frame').disabled).toBe(true);
      expect(button(host, 'Start job').disabled).toBe(true);
      expect(button(host, 'Set origin here').disabled).toBe(true);
      const stepSelect = host.querySelector<HTMLSelectElement>(
        'select[aria-label="Jog step size"]',
      );
      expect(stepSelect?.disabled).toBe(true);
    } finally {
      if (root !== null) {
        await act(async () => root?.unmount());
      }
      host.remove();
    }
  });
});

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const match = [...host.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(label),
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Button not rendered: ${label}`);
  return match;
}
