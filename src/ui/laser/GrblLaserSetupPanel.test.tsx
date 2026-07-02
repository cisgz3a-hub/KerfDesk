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
  useStore.getState().setMachineKind('laser');
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    statusReport: null,
    alarmCode: null,
    lastWriteError: null,
    autofocusBusy: false,
    motionOperation: null,
    streamer: null,
    safetyNotice: null,
  } as Partial<ReturnType<typeof useLaserStore.getState>>);
});

describe('GRBL laser setup panel', () => {
  it('renders a clearly labeled one-time setup write action for connected controllers', async () => {
    const originalSetup = useLaserStore.getState().configureGrblLaserSetup;
    const configure = vi.fn(async () => undefined);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    useLaserStore.setState({
      connection: { kind: 'connected' },
      statusReport: {
        state: 'Idle',
        subState: null,
        mPos: { x: 0, y: 0, z: 0 },
        wPos: null,
        wco: null,
        feed: 0,
        spindle: 0,
      },
      configureGrblLaserSetup: configure,
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

      expect(host.textContent).toContain('Machine Setup');
      await act(async () => {
        button(host, 'Machine Setup').click();
        await Promise.resolve();
      });
      await act(async () => {
        button(host, 'Controller Settings').click();
        await Promise.resolve();
      });

      expect(host.textContent).toContain('One-time GRBL Setup');
      expect(host.textContent).toContain('Writes only the listed GRBL values');
      await act(async () => {
        button(host, 'Apply one-time GRBL setup').click();
        await Promise.resolve();
      });

      expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Neotronics'));
      expect(confirm).not.toHaveBeenCalledWith(expect.stringContaining('$22=0'));
      expect(configure).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => {
        useLaserStore.setState({ configureGrblLaserSetup: originalSetup });
      });
      if (root !== null) {
        await act(async () => root?.unmount());
      }
      host.remove();
      confirm.mockRestore();
    }
  });
});

describe('GRBL laser setup panel in CNC mode', () => {
  it('hides the one-time laser firmware write while the project machine is CNC', async () => {
    useStore.getState().setMachineKind('cnc');
    useLaserStore.setState({
      connection: { kind: 'connected' },
      statusReport: {
        state: 'Idle',
        subState: null,
        mPos: { x: 0, y: 0, z: 0 },
        wPos: null,
        wco: null,
        feed: 0,
        spindle: 0,
      },
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

      expect(host.textContent).toContain('Machine Setup');
      await act(async () => {
        button(host, 'Machine Setup').click();
        await Promise.resolve();
      });
      await act(async () => {
        button(host, 'Controller Settings').click();
        await Promise.resolve();
      });

      expect(host.textContent).not.toContain('One-time GRBL Setup');
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
