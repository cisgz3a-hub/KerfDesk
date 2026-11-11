// USB laser access for the desktop window (ADR-702). navigator.usb's chooser
// arrives here as select-usb-device: main shows only the known laser boards
// (laser-usb-devices.ts), asks the operator which one to open, and grants
// exactly the picked device to the trusted page for this run. Nothing is
// remembered across restarts; the next run asks again.

import {
  BrowserWindow,
  dialog,
  type Event as ElectronEvent,
  type MessageBoxOptions,
  type MessageBoxReturnValue,
  type SelectUsbDeviceDetails,
  type USBDevice,
  type UsbDeviceRevokedDetails,
} from 'electron';
import type { DevicePermissionRouter } from './device-permission-router.js';
import { laserUsbDevice } from './laser-usb-devices.js';
import { isTrustedRendererOrigin } from './trusted-renderer-policy.js';

/** The part of an Electron Session this wiring uses. */
export type UsbSession = {
  on(
    event: 'select-usb-device',
    listener: (
      event: ElectronEvent,
      details: SelectUsbDeviceDetails,
      callback: (deviceId?: string) => void,
    ) => void,
  ): unknown;
  on(
    event: 'usb-device-revoked',
    listener: (event: ElectronEvent, details: UsbDeviceRevokedDetails) => void,
  ): unknown;
};

export type UsbDeviceSummary = Pick<
  USBDevice,
  'deviceId' | 'vendorId' | 'productId' | 'productName' | 'serialNumber'
>;

export type UsbMessageBox = (options: MessageBoxOptions) => Promise<MessageBoxReturnValue>;

export type DesktopUsbDeviceOptions = {
  readonly trustedOrigins: ReadonlySet<string>;
  readonly platform?: NodeJS.Platform;
  /** Shows the chooser; tests pass a scripted one. */
  readonly messageBox?: (owner: BrowserWindow | null) => UsbMessageBox;
};

const hex = (n: number): string => n.toString(16).padStart(4, '0');

export function usbDeviceLabel(device: UsbDeviceSummary): string {
  const family = laserUsbDevice(device)?.label ?? 'USB device';
  const name = device.productName === undefined ? '' : ` "${device.productName}"`;
  return `${family}${name} (${hex(device.vendorId)}:${hex(device.productId)})`;
}

export const NO_USB_LASER_MESSAGE: MessageBoxOptions = {
  type: 'info',
  buttons: ['OK'],
  message: 'No USB laser found',
  detail:
    'Plug the laser in and switch it on, then connect again. On Windows the laser needs the ' +
    'WinUSB driver first (Help explains how, and how to switch back to EZCad or LaserDRW).',
};

/** Asks which known laser to open; '' when there is none or the operator cancels. */
export async function chooseUsbDeviceId(
  devices: ReadonlyArray<UsbDeviceSummary>,
  showMessageBox: UsbMessageBox,
): Promise<string> {
  const lasers = devices.filter((device) => laserUsbDevice(device) !== undefined);
  if (lasers.length === 0) {
    await showMessageBox(NO_USB_LASER_MESSAGE);
    return '';
  }
  const buttons = [...lasers.map(usbDeviceLabel), 'Cancel'];
  const result = await showMessageBox({
    type: 'question',
    buttons,
    cancelId: lasers.length,
    defaultId: 0,
    noLink: true,
    message: 'Select the USB laser to connect',
    detail: 'Simulator-tested only: this connection has not been qualified on hardware.',
  });
  return lasers[result.response]?.deviceId ?? '';
}

function defaultMessageBox(owner: BrowserWindow | null): UsbMessageBox {
  return (options) =>
    owner === null ? dialog.showMessageBox(options) : dialog.showMessageBox(owner, options);
}

const REMEMBERED_PLATFORMS: ReadonlySet<NodeJS.Platform> = new Set(['win32', 'darwin', 'linux']);

export function installDesktopUsbDevices(
  ses: UsbSession,
  permissions: DevicePermissionRouter,
  options: DesktopUsbDeviceOptions,
): void {
  // The router's handler decides every device check once set, so it is set
  // only where serial sets one too (serial-port-grants.ts serialPortIdentity).
  if (!REMEMBERED_PLATFORMS.has(options.platform ?? process.platform)) return;
  const granted = new Set<string>();
  const messageBox = options.messageBox ?? defaultMessageBox;
  permissions.route('usb', (details) => {
    const device = details.device as Partial<UsbDeviceSummary>;
    return (
      isTrustedRendererOrigin(details.origin, options.trustedOrigins) &&
      typeof device.deviceId === 'string' &&
      granted.has(device.deviceId) &&
      laserUsbDevice({ vendorId: device.vendorId ?? -1, productId: device.productId ?? -1 }) !==
        undefined
    );
  });
  ses.on('select-usb-device', (event, details, callback) => {
    event.preventDefault();
    // The chooser opens from the operator's click in the focused window.
    void chooseUsbDeviceId(details.deviceList, messageBox(BrowserWindow.getFocusedWindow()))
      .then((chosen) => {
        // Granted before Chromium hears the answer: the open is checked against it.
        if (chosen !== '') granted.add(chosen);
        callback(chosen === '' ? undefined : chosen);
      })
      .catch((err: unknown) => {
        console.error('USB laser picker failed:', err);
        callback();
      });
  });
  ses.on('usb-device-revoked', (_event, details) => granted.delete(details.device.deviceId));
}
