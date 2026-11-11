import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { DevicePermissionHandlerHandlerDetails } from 'electron';
import { LASER_USB_DEVICES as CORE_LASER_USB_DEVICES } from '../src/core/controllers/usb/laser-usb-devices';
import { createDevicePermissionRouter } from './device-permission-router.js';
import {
  chooseUsbDeviceId,
  installDesktopUsbDevices,
  NO_USB_LASER_MESSAGE,
  usbDeviceLabel,
  type UsbDeviceSummary,
  type UsbMessageBox,
  type UsbSession,
} from './desktop-usb-devices.js';
import { LASER_USB_DEVICES } from './laser-usb-devices.js';
import { PACKAGED_RENDERER_ORIGIN } from './trusted-renderer-policy.js';

vi.mock('electron', () => ({
  BrowserWindow: { getFocusedWindow: () => null },
  dialog: { showMessageBox: vi.fn() },
}));

const k40: UsbDeviceSummary = {
  deviceId: 'k40-1',
  vendorId: 0x1a86,
  productId: 0x5512,
  productName: 'USB2.0-Print',
};
const galvo: UsbDeviceSummary = { deviceId: 'galvo-1', vendorId: 0x9588, productId: 0x9899 };
const mouse: UsbDeviceSummary = { deviceId: 'mouse-1', vendorId: 0x046d, productId: 0xc077 };
const trusted = new Set([PACKAGED_RENDERER_ORIGIN]);

function pick(response: number): UsbMessageBox & ReturnType<typeof vi.fn> {
  return vi.fn(async () => ({ response, checkboxChecked: false })) as never;
}

function usbCheck(device: UsbDeviceSummary, origin = PACKAGED_RENDERER_ORIGIN) {
  return { deviceType: 'usb', origin, device } as unknown as DevicePermissionHandlerHandlerDetails;
}

function setup(messageBox: UsbMessageBox, platform: NodeJS.Platform = 'win32') {
  const events = new EventEmitter();
  let handler: ((details: DevicePermissionHandlerHandlerDetails) => boolean) | null = null;
  const permissionSession = {
    setDevicePermissionHandler: vi.fn((next: typeof handler) => {
      handler = next;
    }),
  };
  const router = createDevicePermissionRouter(permissionSession);
  const session = {
    on: (event: string, listener: (...args: unknown[]) => void) => events.on(event, listener),
  } as unknown as UsbSession;
  installDesktopUsbDevices(session, router, {
    trustedOrigins: trusted,
    platform,
    messageBox: () => messageBox,
  });
  const select = async (deviceList: UsbDeviceSummary[]): Promise<string | undefined> => {
    const preventDefault = vi.fn();
    const chosen = await new Promise<string | undefined>((resolve) =>
      events.emit('select-usb-device', { preventDefault }, { deviceList, frame: null }, resolve),
    );
    expect(preventDefault).toHaveBeenCalled();
    return chosen;
  };
  return {
    events,
    router,
    select,
    allows: (details: DevicePermissionHandlerHandlerDetails) => handler?.(details) ?? null,
  };
}

describe('desktop USB lasers (ADR-702)', () => {
  it('keeps the main-process device list equal to the core one', () => {
    expect(LASER_USB_DEVICES).toEqual(CORE_LASER_USB_DEVICES);
  });

  it('labels a device by its laser family and ids', () => {
    expect(usbDeviceLabel(k40)).toBe(
      'K40 controller (CH341: Lihuiyu M2/M3 Nano, Moshiboard) "USB2.0-Print" (1a86:5512)',
    );
    expect(usbDeviceLabel(galvo)).toBe('Galvo controller (JCZ LMC, EZCad2) (9588:9899)');
  });

  it('offers only known laser boards, and says so when none is attached', async () => {
    const box = pick(1);
    expect(await chooseUsbDeviceId([mouse, k40, galvo], box)).toBe('galvo-1');
    expect(box.mock.calls[0]?.[0].buttons).toEqual([
      usbDeviceLabel(k40),
      usbDeviceLabel(galvo),
      'Cancel',
    ]);
    const none = pick(0);
    expect(await chooseUsbDeviceId([mouse], none)).toBe('');
    expect(none).toHaveBeenCalledWith(NO_USB_LASER_MESSAGE);
    expect(await chooseUsbDeviceId([k40], pick(1))).toBe('');
  });

  it('grants only the picked laser to the trusted page, for this run', async () => {
    const { select, allows } = setup(pick(0));
    expect(allows(usbCheck(k40))).toBe(false);
    expect(await select([k40, galvo])).toBe('k40-1');
    expect(allows(usbCheck(k40))).toBe(true);
    expect(allows(usbCheck(galvo))).toBe(false);
    expect(allows(usbCheck(k40, 'https://example.com'))).toBe(false);
    expect(allows(usbCheck({ ...mouse, deviceId: 'k40-1' }))).toBe(false);
  });

  it('answers a cancelled chooser with no device and grants nothing', async () => {
    const { select, allows } = setup(pick(1));
    expect(await select([k40])).toBeUndefined();
    expect(allows(usbCheck(k40))).toBe(false);
  });

  it('drops a grant the page revokes', async () => {
    const { select, allows, events } = setup(pick(0));
    await select([k40]);
    events.emit('usb-device-revoked', {}, { device: k40 });
    expect(allows(usbCheck(k40))).toBe(false);
  });

  it('shares the session handler with serial, each deciding its own device type', () => {
    const { router, allows } = setup(pick(0));
    router.route('serial', (details) => details.deviceType === 'serial');
    expect(allows({ deviceType: 'serial' } as DevicePermissionHandlerHandlerDetails)).toBe(true);
    expect(allows({ deviceType: 'hid' } as DevicePermissionHandlerHandlerDetails)).toBe(false);
  });

  it('installs nothing where serial keeps Electron’s default handler', () => {
    const { allows } = setup(pick(0), 'freebsd');
    expect(allows(usbCheck(k40))).toBeNull();
  });
});
