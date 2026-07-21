import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
    alarmCode: null,
    statusReport: null,
    streamer: null,
  } as Partial<ReturnType<typeof useLaserStore.getState>>);
});

describe('LaserWindow alarm recovery homing capability', () => {
  it('does not send Home when the selected profile does not support $H', async () => {
    const originalHome = useLaserStore.getState().home;
    const home = vi.fn(async () => undefined);
    useStore.setState({
      project: createProject({
        ...DEFAULT_DEVICE_PROFILE,
        homing: { enabled: false, direction: 'front-left' },
      }),
    });
    useLaserStore.setState({
      connection: { kind: 'connected' },
      statusReport: {
        state: 'Alarm',
        subState: null,
        mPos: { x: 0, y: 0, z: 12.089 },
        wPos: null,
        wco: null,
        feed: 0,
        spindle: 0,
      },
      alarmCode: null,
      home,
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

      // A profile without $H offers the fix instead of a dead grey control:
      // no Home button exists, and its replacement opens Machine Setup rather
      // than sending anything to the controller.
      expect(
        [...host.querySelectorAll('button')].map((candidate) => candidate.textContent),
      ).not.toContain('Home ($H)');
      const setupHoming = button(host, 'Set up homing');
      expect(setupHoming.disabled).toBe(false);
      expect(host.textContent).toContain(
        'Turn on homing in Machine Setup if this machine has homing switches.',
      );

      await act(async () => {
        setupHoming.click();
        await Promise.resolve();
      });

      expect(home).not.toHaveBeenCalled();
      expect(host.textContent).toContain('Machine Setup');
      expect(host.textContent).toContain('Homing');
    } finally {
      await act(async () => {
        useLaserStore.setState({ home: originalHome });
      });
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
