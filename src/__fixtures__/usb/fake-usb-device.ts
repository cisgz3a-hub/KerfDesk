// A scripted USB laser session for tests (ADR-702). It records every transfer
// in order and answers reads from the script, so a controller simulator can
// stand behind it: the CH341 and JCZ drivers then run their real framing
// against the simulator without any hardware.

import type {
  UsbControlSetup,
  UsbDeviceInfo,
  UsbLinkSession,
} from '../../core/controllers/usb/usb-link-session';

export type FakeUsbCall =
  | { readonly kind: 'control-out'; readonly setup: UsbControlSetup; readonly data?: Uint8Array }
  | { readonly kind: 'control-in'; readonly setup: UsbControlSetup; readonly length: number }
  | { readonly kind: 'out'; readonly endpoint: number; readonly data: Uint8Array }
  | { readonly kind: 'in'; readonly endpoint: number; readonly length: number }
  | { readonly kind: 'close' }
  | { readonly kind: 'forget' };

export type FakeUsbScript = {
  readonly info?: UsbDeviceInfo;
  readonly controlOut?: (setup: UsbControlSetup, data?: Uint8Array) => void | Promise<void>;
  readonly controlIn?: (setup: UsbControlSetup, length: number) => Uint8Array | Promise<Uint8Array>;
  readonly transferOut?: (endpoint: number, data: Uint8Array) => void | Promise<void>;
  readonly transferIn?: (endpoint: number, length: number) => Uint8Array | Promise<Uint8Array>;
};

export type FakeUsbDevice = {
  readonly session: UsbLinkSession;
  /** Every call, in order; transfer data is copied when it is made. */
  readonly calls: FakeUsbCall[];
  /** The bytes of every bulk OUT transfer, in order. */
  readonly writes: () => Uint8Array[];
  /** Fires the session's disconnect handlers, as an unplug would. */
  readonly unplug: () => void;
  readonly isClosed: () => boolean;
};

const DEFAULT_INFO: UsbDeviceInfo = { vendorId: 0x1a86, productId: 0x5512 };

export function createFakeUsbDevice(script: FakeUsbScript = {}): FakeUsbDevice {
  const calls: FakeUsbCall[] = [];
  const handlers = new Set<() => void>();
  let closed = false;
  const live = (): void => {
    if (closed) throw new Error('The fake USB device is closed.');
  };
  const session: UsbLinkSession = {
    info: script.info ?? DEFAULT_INFO,
    controlTransferOut: async (setup, data) => {
      live();
      calls.push({
        kind: 'control-out',
        setup,
        ...(data === undefined ? {} : { data: data.slice() }),
      });
      await script.controlOut?.(setup, data);
    },
    controlTransferIn: async (setup, length) => {
      live();
      calls.push({ kind: 'control-in', setup, length });
      return (await script.controlIn?.(setup, length)) ?? new Uint8Array(length);
    },
    transferOut: async (endpoint, data) => {
      live();
      calls.push({ kind: 'out', endpoint, data: data.slice() });
      await script.transferOut?.(endpoint, data);
    },
    transferIn: async (endpoint, length) => {
      live();
      calls.push({ kind: 'in', endpoint, length });
      return (await script.transferIn?.(endpoint, length)) ?? new Uint8Array(length);
    },
    onDisconnect: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    close: async () => {
      calls.push({ kind: 'close' });
      closed = true;
    },
    forget: async () => {
      calls.push({ kind: 'forget' });
      closed = true;
    },
  };
  return {
    session,
    calls,
    writes: () => calls.flatMap((call) => (call.kind === 'out' ? [call.data] : [])),
    unplug: () => {
      closed = true;
      for (const handler of [...handlers]) handler();
    },
    isClosed: () => closed,
  };
}
