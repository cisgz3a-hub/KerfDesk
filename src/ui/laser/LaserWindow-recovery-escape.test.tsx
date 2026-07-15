import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

const originalConnect = useLaserStore.getState().connect;

afterEach(() => {
  useStore.getState().newProject();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    controllerOperation: null,
    safetyNotice: null,
    connect: originalConnect,
  });
});

describe('LaserWindow recovery connection escape', () => {
  it('keeps reconnect usable while stale recovery ownership blocks other controls', async () => {
    const connect = vi.fn(async () => undefined);
    useLaserStore.setState({
      connection: { kind: 'disconnected' },
      controllerOperation: { kind: 'recovery', phase: 'reset', idleReports: 0 },
      connect,
      safetyNotice: {
        kind: 'disconnect-during-job',
        message: 'USB lost mid-job. Use physical E-stop.',
      },
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

      expect(button(host, 'Reconnect controller').disabled).toBe(false);
      expect(button(host, 'Connect…').disabled).toBe(false);
      expect(host.textContent).not.toContain('Recover controller');

      await act(async () => {
        button(host, 'Reconnect controller').click();
        await Promise.resolve();
      });

      expect(connect).toHaveBeenCalledTimes(1);
    } finally {
      if (root !== null) await act(async () => root?.unmount());
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
