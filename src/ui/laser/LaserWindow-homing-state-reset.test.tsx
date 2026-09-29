// Controller audit A-7 (ADR-375). Stock GRBL that refused a `$HX` with error:3
// stays in its homing state and reports Home, not Alarm, until a soft reset
// (https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/system.c#L179-L194).
// No Alarm banner showed, so the rail offered no way out but Disconnect.

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
    resetRequired: false,
  } as Partial<ReturnType<typeof useLaserStore.getState>>);
});

describe('LaserWindow homing-state reset', () => {
  it('offers Reset (Ctrl-X) while the controller stays in its homing state', async () => {
    const originalWake = useLaserStore.getState().wakeController;
    const wake = vi.fn(async () => 'alarm' as const);
    useLaserStore.setState({
      connection: { kind: 'connected' },
      statusReport: {
        state: 'Home',
        subState: null,
        mPos: { x: 5, y: 0, z: 0 },
        wPos: null,
        wco: null,
        feed: 0,
        spindle: 0,
      },
      alarmCode: null,
      streamer: null,
      resetRequired: 'homing-state',
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

      expect(host.textContent).toContain('Controller is stuck in its homing state');
      expect(buttonLabels(host)).not.toContain('$X — Unlock');
      await act(async () => {
        button(host, 'Reset (Ctrl-X)').click();
        await Promise.resolve();
      });
      expect(wake).toHaveBeenCalledTimes(1);

      // Home without the latch is an ordinary report: nothing to offer.
      await act(async () => {
        useLaserStore.setState({ resetRequired: false });
      });
      expect(host.textContent).not.toContain('Controller is stuck in its homing state');
      expect(buttonLabels(host)).not.toContain('Reset (Ctrl-X)');
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

function buttonLabels(host: HTMLElement): string[] {
  return [...host.querySelectorAll('button')].map((candidate) => candidate.textContent ?? '');
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const match = [...host.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(label),
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Button not rendered: ${label}`);
  return match;
}
