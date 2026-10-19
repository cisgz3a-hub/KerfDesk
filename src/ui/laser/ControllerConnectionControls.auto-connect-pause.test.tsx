// ADR-639: the operator's Disconnect and Forget Controller pause auto-connect
// from their own handlers. The store's disconnect stays neutral because Find my
// machine's baud scan uses it, and only a port that opened lifts the pause, so
// "Use a different port…" with a cancelled picker leaves it set.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { resetAutoConnectSession, useAutoConnectSession } from '../state/auto-connect-session';
import { useLaserStore } from '../state/laser-store';
import { forgetControllerAndClearStartBlockers } from './controller-connection-actions';
import { ControllerConnectionControls } from './ControllerConnectionControls';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const platform: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: async () => [],
  pickFileForSave: async () => null,
  serial: { isSupported: () => true, requestPort: async () => null },
};

const original = useLaserStore.getState();
// The picker is cancelled: nothing opens, so nothing lifts the pause.
const connect = vi.fn<typeof original.connect>(async () => undefined);
const disconnect = vi.fn<typeof original.disconnect>(async () => undefined);
const forgetDevice = vi.fn(async () => undefined);
const paused = (): boolean => useAutoConnectSession.getState().paused;
let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  resetAutoConnectSession();
  connect.mockClear();
  disconnect.mockClear();
  useLaserStore.setState({ connection: { kind: 'connected' }, connect, disconnect, forgetDevice });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <PlatformProvider adapter={platform}>
        <ControllerConnectionControls
          machineKind="laser"
          autofocusBusy={false}
          motionOperation={null}
          controllerOperation={null}
          onForget={() => undefined}
        />
      </PlatformProvider>,
    ),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useLaserStore.setState({
    connection: original.connection,
    connect: original.connect,
    disconnect: original.disconnect,
    forgetDevice: original.forgetDevice,
  });
  resetAutoConnectSession();
});

it('pauses auto-connect when the operator clicks Disconnect', async () => {
  const button = [...host.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === 'Disconnect',
  );
  await act(async () => button?.click());
  expect(disconnect).toHaveBeenCalledOnce();
  expect(paused()).toBe(true);
});

it('stays paused when Use a different port… is cancelled', async () => {
  const more = host.querySelector<HTMLButtonElement>(
    'button[aria-label="More connection options"]',
  );
  await act(async () => more?.click());
  const choose = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (item) => item.textContent?.includes('Use a different port…') === true,
  );
  await act(async () => choose?.click());
  expect(disconnect).toHaveBeenCalledOnce();
  expect(connect).toHaveBeenCalledOnce();
  expect(connect.mock.calls[0]?.[1]).toMatchObject({ portSelection: 'choose' });
  expect(paused()).toBe(true);
});

it('pauses auto-connect when the operator forgets the controller', async () => {
  await forgetControllerAndClearStartBlockers();
  expect(forgetDevice).toHaveBeenCalledOnce();
  expect(paused()).toBe(true);
});
