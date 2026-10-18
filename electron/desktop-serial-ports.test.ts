import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DevicePermissionHandlerHandlerDetails } from 'electron';
import { installDesktopSerialPorts, type SerialSession } from './desktop-serial-ports.js';
import { readSerialPortGrants, SERIAL_PORT_GRANTS_FILE } from './serial-port-grants.js';
import { PACKAGED_RENDERER_ORIGIN } from './trusted-renderer-policy.js';

const showMessageBox = vi.hoisted(() => vi.fn());
vi.mock('electron', () => ({
  app: { isPackaged: true },
  BrowserWindow: { fromWebContents: () => null },
  dialog: { showMessageBox },
}));

const LASER_ID = 'USB\\VID_1A86&PID_7523\\5&2A6E7D8C&0&2';
const TWIN_ID = 'USB\\VID_1A86&PID_7523\\5&2A6E7D8C&0&3';
const laser = {
  portId: 'laser-token',
  portName: 'COM5',
  displayName: 'USB-SERIAL CH340 (COM5)',
  vendorId: '6790',
  productId: '29987',
  deviceInstanceId: LASER_ID,
};
const twin = { ...laser, portId: 'twin-token', portName: 'COM7', deviceInstanceId: TWIN_ID };
const trusted = new Set([PACKAGED_RENDERER_ORIGIN]);

function serialCheck(
  id: string,
  overrides: Partial<{ deviceType: string; origin: string }> = {},
): DevicePermissionHandlerHandlerDetails {
  return {
    deviceType: 'serial',
    origin: PACKAGED_RENDERER_ORIGIN,
    device: { name: 'USB-SERIAL CH340', device_instance_id: id },
    ...overrides,
  } as unknown as DevicePermissionHandlerHandlerDetails;
}

function fakeSession() {
  const events = new EventEmitter();
  let handler: ((details: DevicePermissionHandlerHandlerDetails) => boolean) | null = null;
  const session = {
    on: (event: string, listener: (...args: unknown[]) => void) => events.on(event, listener),
    setDevicePermissionHandler: vi.fn(
      (next: ((details: DevicePermissionHandlerHandlerDetails) => boolean) | null) => {
        handler = next;
      },
    ),
  };
  return {
    session: session as unknown as SerialSession,
    events,
    setDevicePermissionHandler: session.setDevicePermissionHandler,
    allows: (details: DevicePermissionHandlerHandlerDetails): boolean | null =>
      handler === null ? null : handler(details),
  };
}

function pick(
  events: EventEmitter,
  ports: ReadonlyArray<typeof laser>,
  response: number,
): Promise<string> {
  showMessageBox.mockResolvedValueOnce({ response });
  return new Promise((resolve) => {
    events.emit('select-serial-port', { preventDefault: vi.fn() }, ports, {}, resolve);
  });
}

describe('desktop serial ports', () => {
  let userDataPath = '';
  beforeEach(() => {
    userDataPath = mkdtempSync(join(tmpdir(), 'kerfdesk-serial-ports-'));
    showMessageBox.mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    rmSync(userDataPath, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('installs no device permission handler where Electron remembers no port (ADR-366)', async () => {
    const { session, events, setDevicePermissionHandler } = fakeSession();
    installDesktopSerialPorts(session, {
      trustedOrigins: trusted,
      userDataPath,
      platform: 'freebsd',
    });

    await expect(pick(events, [laser, twin], 1)).resolves.toBe('twin-token');
    expect(setDevicePermissionHandler).not.toHaveBeenCalled();
    expect(events.listenerCount('serial-port-revoked')).toBe(0);
    expect(readSerialPortGrants(join(userDataPath, SERIAL_PORT_GRANTS_FILE))).toEqual([]);
  });

  it('on Windows grants the trusted page only the port picked in the dialog', async () => {
    const { session, events, allows } = fakeSession();
    installDesktopSerialPorts(session, {
      trustedOrigins: trusted,
      userDataPath,
      platform: 'win32',
    });
    expect(allows(serialCheck(LASER_ID))).toBe(false);

    await expect(pick(events, [laser, twin], 0)).resolves.toBe('laser-token');

    expect(allows(serialCheck(LASER_ID))).toBe(true);
    expect(allows(serialCheck(TWIN_ID))).toBe(false);
    expect(allows(serialCheck(LASER_ID, { origin: 'https://example.com' }))).toBe(false);
    expect(allows(serialCheck(LASER_ID, { deviceType: 'hid' }))).toBe(false);
  });

  it('grants nothing when the operator cancels the dialog', async () => {
    const { session, events, allows } = fakeSession();
    installDesktopSerialPorts(session, {
      trustedOrigins: trusted,
      userDataPath,
      platform: 'win32',
    });

    await expect(pick(events, [laser, twin], 2)).resolves.toBe('');

    expect(allows(serialCheck(LASER_ID))).toBe(false);
    expect(allows(serialCheck(TWIN_ID))).toBe(false);
  });

  it('remembers a pick across restarts until the window forgets the port', async () => {
    const file = join(userDataPath, SERIAL_PORT_GRANTS_FILE);
    const first = fakeSession();
    installDesktopSerialPorts(first.session, {
      trustedOrigins: trusted,
      userDataPath,
      platform: 'win32',
    });
    await pick(first.events, [laser, twin], 0);
    await vi.waitFor(() => expect(readSerialPortGrants(file)).toHaveLength(1));

    const restarted = fakeSession();
    installDesktopSerialPorts(restarted.session, {
      trustedOrigins: trusted,
      userDataPath,
      platform: 'win32',
    });
    expect(restarted.allows(serialCheck(LASER_ID))).toBe(true);

    restarted.events.emit(
      'serial-port-revoked',
      {},
      { port: laser, origin: PACKAGED_RENDERER_ORIGIN },
    );
    expect(restarted.allows(serialCheck(LASER_ID))).toBe(false);
    await vi.waitFor(() => expect(readSerialPortGrants(file)).toEqual([]));

    const again = fakeSession();
    installDesktopSerialPorts(again.session, {
      trustedOrigins: trusted,
      userDataPath,
      platform: 'win32',
    });
    expect(again.allows(serialCheck(LASER_ID))).toBe(false);
  });

  it('makes the port picked last the dialog default', async () => {
    const { session, events } = fakeSession();
    installDesktopSerialPorts(session, {
      trustedOrigins: trusted,
      userDataPath,
      platform: 'win32',
    });
    await pick(events, [laser, twin], 0);
    expect(showMessageBox).toHaveBeenLastCalledWith(expect.objectContaining({ defaultId: 0 }));

    await pick(events, [laser, twin], 1);
    await pick(events, [laser, twin], 1);
    expect(showMessageBox).toHaveBeenLastCalledWith(
      expect.objectContaining({ defaultId: 1, cancelId: 2 }),
    );
  });

  // Electron's stored form on macOS and Linux (serial_chooser_context.cc
  // PortInfoToValue): USB IDs as numbers, the serial number, and on macOS the
  // USB driver name (ADR-607).
  const ftdi = {
    portId: 'ftdi-token',
    portName: 'cu.usbserial-A10KJ3QZ',
    displayName: 'FT232R USB UART',
    vendorId: '1027',
    productId: '24577',
    serialNumber: 'A10KJ3QZ',
    usbDriverName: 'AppleUSBFTDI',
  };
  const ftdiTwin = { ...ftdi, portId: 'twin-token', serialNumber: 'A10KJ3R0' };
  const posixCheck = (serial: string, driver?: string): DevicePermissionHandlerHandlerDetails =>
    ({
      deviceType: 'serial',
      origin: PACKAGED_RENDERER_ORIGIN,
      device: {
        name: 'FT232R USB UART',
        vendor_id: 1027,
        product_id: 24577,
        serial_number: serial,
        ...(driver === undefined ? {} : { usb_driver: driver }),
      },
    }) as unknown as DevicePermissionHandlerHandlerDetails;

  it('on macOS remembers a pick across restarts by its USB IDs, serial number and driver', async () => {
    const file = join(userDataPath, SERIAL_PORT_GRANTS_FILE);
    const first = fakeSession();
    installDesktopSerialPorts(first.session, {
      trustedOrigins: trusted,
      userDataPath,
      platform: 'darwin',
    });
    expect(first.allows(posixCheck('A10KJ3QZ', 'AppleUSBFTDI'))).toBe(false);

    await expect(pick(first.events, [ftdi, ftdiTwin] as never, 0)).resolves.toBe('ftdi-token');
    expect(first.allows(posixCheck('A10KJ3QZ', 'AppleUSBFTDI'))).toBe(true);
    expect(first.allows(posixCheck('A10KJ3R0', 'AppleUSBFTDI'))).toBe(false);
    // The vendor's own driver lists the same adapter as a second port.
    expect(first.allows(posixCheck('A10KJ3QZ', 'FTDIUSBSerialDriver'))).toBe(false);
    await vi.waitFor(() => expect(readSerialPortGrants(file)).toHaveLength(1));

    const restarted = fakeSession();
    installDesktopSerialPorts(restarted.session, {
      trustedOrigins: trusted,
      userDataPath,
      platform: 'darwin',
    });
    expect(restarted.allows(posixCheck('A10KJ3QZ', 'AppleUSBFTDI'))).toBe(true);
    expect(
      restarted.allows({
        ...posixCheck('A10KJ3QZ', 'AppleUSBFTDI'),
        origin: 'https://example.com',
      }),
    ).toBe(false);

    restarted.events.emit(
      'serial-port-revoked',
      {},
      { port: ftdi, origin: PACKAGED_RENDERER_ORIGIN },
    );
    expect(restarted.allows(posixCheck('A10KJ3QZ', 'AppleUSBFTDI'))).toBe(false);
    await vi.waitFor(() => expect(readSerialPortGrants(file)).toEqual([]));
  });

  it('on Linux remembers a pick by its USB IDs and serial number, and makes it the default', async () => {
    const linuxPort = { ...ftdi, portName: 'ttyUSB0', usbDriverName: undefined };
    const linuxTwin = {
      ...linuxPort,
      portId: 'twin-token',
      portName: 'ttyUSB1',
      serialNumber: 'A10KJ3R0',
    };
    const { session, events, allows } = fakeSession();
    installDesktopSerialPorts(session, {
      trustedOrigins: trusted,
      userDataPath,
      platform: 'linux',
    });

    await expect(pick(events, [linuxPort, linuxTwin] as never, 1)).resolves.toBe('twin-token');
    expect(allows(posixCheck('A10KJ3R0'))).toBe(true);
    expect(allows(posixCheck('A10KJ3QZ'))).toBe(false);

    await pick(events, [linuxPort, linuxTwin] as never, 1);
    expect(showMessageBox).toHaveBeenLastCalledWith(expect.objectContaining({ defaultId: 1 }));
  });
});
