// Controller audit 2026-09-25 RU-6: the menu/command-palette Connect reached
// runConnectAction for a file-only Ruida profile, which picked and opened a
// serial port with a driver that has no serial protocol and reported
// "connected". ADR-097 decision 3: the file-only capability disables Connect.
// Refusing is allowed here because it is a factual transport inability, not a
// policy judgment (frame-first rules, ADR-228).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { profileCatalogEntryById } from '../../core/devices/profile-catalog';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { connectOptionsForDevice } from '../commands/connect-options';
import { FILE_ONLY_CONNECT_REFUSAL } from './laser-connect-action';
import { useLaserStore } from './laser-store';
import { useToastStore } from './toast-store';

function silentConnection(): SerialConnection {
  return {
    write: async () => undefined,
    onLine: () => () => undefined,
    onClose: () => () => undefined,
    close: async () => undefined,
  };
}

afterEach(async () => {
  await useLaserStore
    .getState()
    .disconnect()
    .catch(() => undefined);
  useLaserStore.setState({ connection: { kind: 'disconnected' }, log: [], transcript: [] });
  vi.restoreAllMocks();
});

describe('a file-only Ruida profile cannot open a serial connection', () => {
  it('refuses Connect before the port picker and says why', async () => {
    const entry = profileCatalogEntryById('generic-ruida-rd-export');
    if (entry === undefined) throw new Error('missing generic Ruida profile');
    const requestPort = vi.fn(async () => ({ open: async () => silentConnection() }));
    const adapter: PlatformAdapter = {
      id: 'mock',
      pickFilesForOpen: async () => [],
      pickFileForSave: async () => null,
      serial: { isSupported: () => true, requestPort },
    };
    const pushToast = vi.spyOn(useToastStore.getState(), 'pushToast');

    // Exactly what the menu and command palette "Connect" run (use-app-commands.ts).
    await useLaserStore.getState().connect(adapter, connectOptionsForDevice(entry.profile));

    expect(requestPort).not.toHaveBeenCalled();
    expect(useLaserStore.getState().connection).toEqual({ kind: 'disconnected' });
    expect(useLaserStore.getState().log.at(-1)).toContain(FILE_ONLY_CONNECT_REFUSAL);
    expect(pushToast).toHaveBeenCalledWith(FILE_ONLY_CONNECT_REFUSAL, 'error');
  });
});
