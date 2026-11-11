// The USB laser link (ADR-702): the narrow surface the CH341 boards (Lihuiyu
// M2/M3 Nano, Moshiboard) and the JCZ LMC galvo boards are driven through.
// PlatformAdapter carries it as `usbLink` where the page has WebUSB — Chromium
// browsers and the desktop app; Firefox and Safari have none. The session
// shape lives in core so the controller drivers can use it.

import type { UsbDeviceFilter, UsbLinkSession } from '../core/controllers/usb/usb-link-session';

export type {
  UsbControlSetup,
  UsbDeviceFilter,
  UsbDeviceInfo,
  UsbLinkSession,
} from '../core/controllers/usb/usb-link-session';

/** Why a device could not be opened. `driver` is the Windows case: the
 *  device still has its vendor driver (or none) instead of WinUSB. */
export type UsbLinkOpenFailure = 'driver' | 'busy' | 'gone' | 'unknown';

export class UsbLinkOpenError extends Error {
  readonly failure: UsbLinkOpenFailure;

  constructor(failure: UsbLinkOpenFailure, message: string) {
    super(message);
    this.name = 'UsbLinkOpenError';
    this.failure = failure;
  }
}

export type UsbLinkAdapter = {
  /** Shows the device chooser, limited to `filters`. Resolves to null when
   *  the operator cancels or no listed device is attached; rejects with a
   *  UsbLinkOpenError when the picked device cannot be opened. */
  readonly request: (filters: ReadonlyArray<UsbDeviceFilter>) => Promise<UsbLinkSession | null>;
  /** Opens a device this page was already granted, without a chooser; null
   *  when none of `filters` is granted and attached. */
  readonly reopen: (filters: ReadonlyArray<UsbDeviceFilter>) => Promise<UsbLinkSession | null>;
};
