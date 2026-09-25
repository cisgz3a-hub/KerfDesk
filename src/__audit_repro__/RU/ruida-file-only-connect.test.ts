// Audit track RU, finding RU-6 — FAILS on current code.
//
// Defect: a file-only controller (Ruida, capabilities.transport 'file-only')
// can still open a serial port. The rail disables Connect for file-only
// profiles (ui/laser/ControllerConnectionControls.tsx), but the menu/command
// Connect (ui/commands/laser-command-family.ts: enabled whenever
// `ctx.serialSupported && !ctx.connected`; use-app-commands.ts passes
// `serialSupported: platform.serial.isSupported()` and calls
// `laser.connect(platform, connectOptionsForDevice(device))`) reaches
// runConnectAction, which picks and opens a port with the Ruida driver and
// reports "connected". ADR-097 decision 3 says the file-only capability
// "disables Connect and all live controls for Ruida profiles".
//
// Correct behaviour: connecting with a file-only driver is refused before the
// port picker (a factual transport inability: the Ruida driver has no serial
// protocol), and the store never reaches `connected`.
// Protocol evidence that no serial G-code link exists: EduTech wiki "Ruida" —
// the controller takes swizzled .rd data over UDP 50200 or USB (FT245R, 19200
// bps), not G-code; meerk40t ruida/usb_transport.py / udp_transport.py.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { profileCatalogEntryById } from '../../core/devices/profile-catalog';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { connectOptionsForDevice } from '../../ui/commands/connect-options';
import { useLaserStore } from '../../ui/state/laser-store';

function silentConnection(writes: string[]): SerialConnection {
  return {
    write: async (data) => {
      writes.push(data);
    },
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

describe('RU-6: a file-only Ruida profile cannot open a serial connection', () => {
  it('refuses Connect before the port picker', async () => {
    const entry = profileCatalogEntryById('generic-ruida-rd-export');
    if (entry === undefined) throw new Error('missing generic Ruida profile');
    const writes: string[] = [];
    const requestPort = vi.fn(async () => ({ open: async () => silentConnection(writes) }));
    const adapter: PlatformAdapter = {
      id: 'mock',
      pickFilesForOpen: async () => [],
      pickFileForSave: async () => null,
      serial: { isSupported: () => true, requestPort },
    };

    // Exactly what the menu/command palette "Connect" runs (use-app-commands.ts).
    await useLaserStore.getState().connect(adapter, connectOptionsForDevice(entry.profile));

    expect(requestPort).not.toHaveBeenCalled();
    expect(useLaserStore.getState().connection.kind).not.toBe('connected');
  });
});
