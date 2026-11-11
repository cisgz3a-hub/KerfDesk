// An opened USB laser device (ADR-702), as the controller code drives it. The
// platform's link (src/platform/usb-link-types.ts) hands these out; core owns
// the shape so the CH341 and JCZ drivers here can use it without importing
// platform code. Every machine path on it is simulator-tested only and not
// qualified on hardware.

/** One USB device a laser family answers to. */
export type UsbDeviceFilter = {
  readonly vendorId: number;
  readonly productId: number;
};

export type UsbDeviceInfo = UsbDeviceFilter & {
  readonly productName?: string;
  readonly serialNumber?: string;
};

/** The setup packet of a control transfer, as WebUSB names its fields. */
export type UsbControlSetup = {
  readonly requestType: 'standard' | 'class' | 'vendor';
  readonly recipient: 'device' | 'interface' | 'endpoint' | 'other';
  readonly request: number;
  readonly value: number;
  readonly index: number;
};

/**
 * An opened, claimed device. Endpoints are endpoint NUMBERS without the
 * direction bit, as WebUSB takes them: bulk OUT 0x02 is 2, bulk IN 0x82 is 2,
 * bulk IN 0x88 is 8. A transfer that does not complete rejects; nothing here
 * retries, because a resent packet could run the same laser commands twice.
 */
export type UsbLinkSession = {
  readonly info: UsbDeviceInfo;
  readonly controlTransferOut: (setup: UsbControlSetup, data?: Uint8Array) => Promise<void>;
  readonly controlTransferIn: (setup: UsbControlSetup, length: number) => Promise<Uint8Array>;
  readonly transferOut: (endpointNumber: number, data: Uint8Array) => Promise<void>;
  readonly transferIn: (endpointNumber: number, length: number) => Promise<Uint8Array>;
  /** The device went away (unplugged, powered off, or closed). Returns an unsubscribe. */
  readonly onDisconnect: (handler: () => void) => () => void;
  /** Releases the device; the permission stays, so the link can reopen it. */
  readonly close: () => Promise<void>;
  /** Closes and revokes the page's permission for this device. */
  readonly forget: () => Promise<void>;
};
