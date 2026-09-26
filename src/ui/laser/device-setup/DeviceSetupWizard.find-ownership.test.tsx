// Only Find my machine owns the connection (ADR-420 rule 6). A new machine's
// draft fills itself when setup opens, and that fill may adopt the firmware
// the banner named, but opening setup must not drop and reopen a connection
// made elsewhere. The 2026-09-26 review of #941 reproduced that reconnect.

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ControllerKind } from '../../../core/devices';
import type { ConnectControllerOptions } from '../../state/laser-store';
import { useLaserStore } from '../../state/laser-store';
import { initialLaserState } from '../../state/laser-store-helpers';
import { resetStore } from '../../state/test-helpers';
import { mockPlatform, renderWizard } from './device-setup-wizard.test-support';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const original = useLaserStore.getState();

beforeEach(() => {
  resetStore();
  useLaserStore.setState(initialLaserState());
});

afterEach(() => {
  resetStore();
  useLaserStore.setState(original, true);
});

// A simulated controller that answers as `reports` whatever driver it was
// opened with. Like the store, connect and disconnect move the attempt
// revision before their first await.
function answeringController(
  readAt: { value: number },
  reports: (options: ConnectControllerOptions) => ControllerKind = () => 'grblhal',
) {
  const connect = vi.fn(async (_adapter: unknown, options: ConnectControllerOptions) => {
    moveAttempt();
    readAt.value += 1;
    useLaserStore.setState({
      connection: { kind: 'connected' },
      activeControllerKind: options.controllerKind ?? 'grbl-v1.1',
      detectedControllerKind: reports(options),
      detectedSettings: { bedWidth: 363, bedHeight: 273, laserModeEnabled: true },
      lastSettingsReadAt: readAt.value,
    });
  });
  const disconnect = vi.fn(async () => {
    moveAttempt();
    useLaserStore.setState({ connection: { kind: 'disconnected' } });
  });
  useLaserStore.setState({ connect, disconnect } as Partial<
    ReturnType<typeof useLaserStore.getState>
  >);
  return { connect, disconnect };
}

function moveAttempt(): void {
  useLaserStore.setState((state) => ({ connectionAttempt: (state.connectionAttempt ?? 0) + 1 }));
}

describe('Find my machine owns the connection', () => {
  it('fills a new machine on open but keeps a connection made elsewhere', async () => {
    const link = answeringController({ value: 1 });
    useLaserStore.setState({
      connection: { kind: 'connected' },
      activeControllerKind: 'grbl-v1.1',
      detectedControllerKind: 'grblhal',
      detectedSettings: { bedWidth: 363, bedHeight: 273, laserModeEnabled: true },
      lastSettingsReadAt: 1,
    });
    const view = await renderWizard(undefined, mockPlatform(), { newMachine: true });
    try {
      // The draft adopted the reported firmware by itself...
      expect(view.host.querySelector('.lf-setup-found-filled')?.textContent).toContain(
        'Controller set to',
      );
      // ...and the connection opened elsewhere was not touched.
      expect(link.disconnect).not.toHaveBeenCalled();
      expect(link.connect).not.toHaveBeenCalled();
      expect(view.host.textContent).toContain('Reconnect using selected profile');
    } finally {
      await view.unmount();
    }
  });

  it('reconnects once with the adopted firmware after Find', async () => {
    const link = answeringController({ value: 0 });
    const view = await renderWizard(undefined, mockPlatform(), { newMachine: true });
    try {
      await act(async () => button(view.host, 'Find my machine').click());
      expect(link.disconnect).toHaveBeenCalledTimes(1);
      expect(link.connect).toHaveBeenCalledTimes(2);
      expect(link.connect.mock.calls[1]?.[1]).toMatchObject({ controllerKind: 'grblhal' });
    } finally {
      await view.unmount();
    }
  });

  // Second review of #941: Find's claim outlived its connection, so a later
  // connection made elsewhere was adopted and dropped without a new Find.
  it("ends Find's claim when another connection replaces Find's", async () => {
    const link = answeringController(
      { value: 0 },
      (options) => options.controllerKind ?? 'grbl-v1.1',
    );
    const view = await renderWizard(undefined, mockPlatform(), { newMachine: true });
    try {
      await act(async () => button(view.host, 'Find my machine').click());
      expect(link.connect).toHaveBeenCalledTimes(1);
      await act(async () => {
        // Reconnected elsewhere, and this controller reports grblHAL.
        moveAttempt();
        useLaserStore.setState({
          connection: { kind: 'connected' },
          activeControllerKind: 'grbl-v1.1',
          detectedControllerKind: 'grblhal',
          lastSettingsReadAt: 50,
        });
      });
      expect(link.disconnect).not.toHaveBeenCalled();
      expect(link.connect).toHaveBeenCalledTimes(1);
      expect(view.host.textContent).toContain('Reconnect using selected profile');
    } finally {
      await view.unmount();
    }
  });
});

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const match = [...host.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Button not rendered: ${label}`);
  return match;
}
