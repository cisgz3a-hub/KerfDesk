// The USB laser link over WebUSB (ADR-702). Chromium browsers and the desktop
// app's window both expose navigator.usb; the desktop main process answers its
// chooser and grants (electron/desktop-usb-devices.ts). WebUSB has no
// declarations in lib.dom, so the few members used are typed here.

import {
  UsbLinkOpenError,
  type UsbControlSetup,
  type UsbDeviceFilter,
  type UsbLinkAdapter,
  type UsbLinkSession,
} from '../usb-link-types';

type WebUsbTransferStatus = 'ok' | 'stall' | 'babble';

/** The members of WebUSB's USBDevice this link uses. */
export type WebUsbDevice = {
  readonly vendorId: number;
  readonly productId: number;
  readonly productName?: string | undefined;
  readonly serialNumber?: string | undefined;
  readonly configuration: unknown;
  open(): Promise<void>;
  close(): Promise<void>;
  forget?(): Promise<void>;
  selectConfiguration(value: number): Promise<void>;
  claimInterface(interfaceNumber: number): Promise<void>;
  releaseInterface(interfaceNumber: number): Promise<void>;
  controlTransferOut(
    setup: UsbControlSetup,
    data?: Uint8Array,
  ): Promise<{ readonly status: WebUsbTransferStatus }>;
  controlTransferIn(
    setup: UsbControlSetup,
    length: number,
  ): Promise<{ readonly status: WebUsbTransferStatus; readonly data?: DataView | undefined }>;
  transferOut(
    endpointNumber: number,
    data: Uint8Array,
  ): Promise<{ readonly status: WebUsbTransferStatus }>;
  transferIn(
    endpointNumber: number,
    length: number,
  ): Promise<{ readonly status: WebUsbTransferStatus; readonly data?: DataView | undefined }>;
};

/** The members of WebUSB's navigator.usb this link uses. */
export type WebUsb = {
  requestDevice(options: { filters: UsbDeviceFilter[] }): Promise<WebUsbDevice>;
  getDevices(): Promise<WebUsbDevice[]>;
  addEventListener(type: 'disconnect', listener: (event: Event) => void): void;
  removeEventListener(type: 'disconnect', listener: (event: Event) => void): void;
};

// The laser boards this link drives have one configuration and talk on
// interface 0 (MeerK40t ch341/libusb.py and balormk/usb_connection.py claim
// the active configuration's (0, 0) interface).
const CONFIGURATION = 1;
const INTERFACE = 0;

function matches(device: WebUsbDevice, filters: ReadonlyArray<UsbDeviceFilter>): boolean {
  return filters.some((f) => f.vendorId === device.vendorId && f.productId === device.productId);
}

function errorName(err: unknown): string {
  return err instanceof Error || (typeof err === 'object' && err !== null && 'name' in err)
    ? String((err as { name: unknown }).name)
    : '';
}

/** Maps a WebUSB open/claim rejection to a reason the panel can explain. */
export function usbOpenError(err: unknown, stage: 'open' | 'claim'): UsbLinkOpenError {
  const name = errorName(err);
  if (name === 'SecurityError')
    return new UsbLinkOpenError(
      'driver',
      'The system would not let KerfDesk open this laser. On Windows it needs the WinUSB driver; on Linux, a udev rule.',
    );
  if (name === 'NotFoundError')
    return new UsbLinkOpenError('gone', 'The laser was unplugged or switched off.');
  if (name === 'NetworkError' && stage === 'claim')
    return new UsbLinkOpenError(
      'busy',
      'Another program is using this laser. Close it (LightBurn, EZCad, LaserDRW, MeerK40t), then connect again.',
    );
  if (name === 'NetworkError')
    return new UsbLinkOpenError(
      'driver',
      'The laser could not be opened. On Windows it needs the WinUSB driver.',
    );
  return new UsbLinkOpenError('unknown', `The laser could not be opened (${name || 'error'}).`);
}

function checked(status: WebUsbTransferStatus, what: string): void {
  if (status !== 'ok') throw new Error(`USB ${what} ended with ${status}.`);
}

function bytesOf(data: DataView | undefined): Uint8Array {
  if (data === undefined) return new Uint8Array(0);
  return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
}

async function openDevice(device: WebUsbDevice): Promise<void> {
  try {
    await device.open();
  } catch (err) {
    throw usbOpenError(err, 'open');
  }
  try {
    if (device.configuration === null) await device.selectConfiguration(CONFIGURATION);
  } catch (err) {
    // The device is open: release it, as a failed claim does (C2 D1-P3-1).
    await device.close().catch(() => undefined);
    throw usbOpenError(err, 'open');
  }
  try {
    await device.claimInterface(INTERFACE);
  } catch (err) {
    await device.close().catch(() => undefined);
    throw usbOpenError(err, 'claim');
  }
}

function sessionFor(usb: WebUsb, device: WebUsbDevice): UsbLinkSession {
  const release = async (): Promise<void> => {
    await device.releaseInterface(INTERFACE).catch(() => undefined);
    await device.close().catch(() => undefined);
  };
  return {
    info: {
      vendorId: device.vendorId,
      productId: device.productId,
      ...(device.productName === undefined ? {} : { productName: device.productName }),
      ...(device.serialNumber === undefined ? {} : { serialNumber: device.serialNumber }),
    },
    controlTransferOut: async (setup, data) =>
      checked((await device.controlTransferOut(setup, data)).status, 'control write'),
    controlTransferIn: async (setup, length) => {
      const result = await device.controlTransferIn(setup, length);
      checked(result.status, 'control read');
      return bytesOf(result.data);
    },
    transferOut: async (endpoint, data) =>
      checked((await device.transferOut(endpoint, data)).status, 'write'),
    transferIn: async (endpoint, length) => {
      const result = await device.transferIn(endpoint, length);
      checked(result.status, 'read');
      return bytesOf(result.data);
    },
    onDisconnect: (handler) => {
      const listener = (event: Event): void => {
        if ((event as Event & { device?: unknown }).device === device) handler();
      };
      usb.addEventListener('disconnect', listener);
      return () => usb.removeEventListener('disconnect', listener);
    },
    close: release,
    forget: async () => {
      await release();
      await device.forget?.().catch(() => undefined);
    },
  };
}

/** The adapter over a WebUSB object; tests pass a fake one. */
export function createWebUsbLink(usb: WebUsb): UsbLinkAdapter {
  return {
    request: async (filters) => {
      let device: WebUsbDevice;
      try {
        device = await usb.requestDevice({ filters: [...filters] });
      } catch (err) {
        // NotFoundError: the operator cancelled, or nothing listed is attached.
        if (errorName(err) === 'NotFoundError') return null;
        throw err;
      }
      await openDevice(device);
      return sessionFor(usb, device);
    },
    reopen: async (filters) => {
      const device = (await usb.getDevices()).find((d) => matches(d, filters));
      if (device === undefined) return null;
      await openDevice(device);
      return sessionFor(usb, device);
    },
  };
}

/** navigator.usb as a link, or undefined where the browser has no WebUSB. */
export function webUsbLink(): UsbLinkAdapter | undefined {
  if (typeof navigator === 'undefined') return undefined;
  const usb = (navigator as Navigator & { usb?: WebUsb }).usb;
  return usb === undefined ? undefined : createWebUsbLink(usb);
}
