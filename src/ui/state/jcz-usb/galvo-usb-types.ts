// The slice of ADR-702's USB link contract (platform/usb-link-types.ts) the
// galvo store uses, typed structurally: a UsbLinkAdapter and UsbLinkSession
// satisfy these as they are. Endpoints are numbers without the direction bit.

import type { LmcUsbTransport } from '../../../core/controllers/jcz/lmc-link';

export type GalvoUsbDeviceFilter = { readonly vendorId: number; readonly productId: number };

export type GalvoUsbSession = LmcUsbTransport & {
  readonly info: {
    readonly vendorId: number;
    readonly productId: number;
    readonly productName?: string;
    readonly serialNumber?: string;
  };
  readonly onDisconnect: (handler: () => void) => () => void;
  readonly close: () => Promise<void>;
};

export type GalvoUsbAdapter = {
  /** Shows the device chooser; null when the operator chose nothing. */
  readonly request: (
    filters: ReadonlyArray<GalvoUsbDeviceFilter>,
  ) => Promise<GalvoUsbSession | null>;
  /** Reopens a device the operator already granted, without a chooser. */
  readonly reopen: (
    filters: ReadonlyArray<GalvoUsbDeviceFilter>,
  ) => Promise<GalvoUsbSession | null>;
};
