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

afterEach(() => {
  useStore.getState().newProject();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    alarmCode: null,
    statusReport: null,
    streamer: null,
  } as Partial<ReturnType<typeof useLaserStore.getState>>);
});

describe('LaserWindow Sleep recovery', () => {
  it('shows an in-app wake control when GRBL reports Sleep', async () => {
    const originalWake = useLaserStore.getState().wakeController;
    const wake = vi.fn(async () => undefined);
    useLaserStore.setState({
      connection: { kind: 'connected' },
      statusReport: {
        state: 'Sleep',
        subState: null,
        mPos: { x: 0, y: 0, z: 0 },
        wPos: null,
        wco: null,
        feed: 0,
        spindle: 0,
      },
      alarmCode: null,
      streamer: null,
      wakeController: wake,
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
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

      expect(host.textContent).toContain('Controller is asleep');
      expect(host.textContent).toContain('Wake (Ctrl-X)');
      expect(button(host, 'Set up & Frame').disabled).toBe(false);
      expect(button(host, 'Frame job').disabled).toBe(true);

      await act(async () => {
        button(host, 'Wake').click();
        await Promise.resolve();
      });

      expect(wake).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => {
        useLaserStore.setState({ wakeController: originalWake });
      });
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
