// The USB laser controllers KerfDesk can open (ADR-702). The browser chooser is
// limited to these, and the desktop app grants nothing else; the desktop main
// process keeps its own copy (electron/laser-usb-devices.ts), which a test
// holds equal to this one.

import { CH341_USB_FILTER } from './ch341-epp';
import type { UsbDeviceFilter } from './usb-link-session';

/** JCZ LMC galvo boards (EZCad2): meerk40t balormk/usb_connection.py L13-14. */
export const JCZ_LMC_USB_FILTER: UsbDeviceFilter = { vendorId: 0x9588, productId: 0x9899 };

export type LaserUsbDevice = UsbDeviceFilter & { readonly label: string };

export const LASER_USB_DEVICES: ReadonlyArray<LaserUsbDevice> = [
  { ...CH341_USB_FILTER, label: 'K40 controller (CH341: Lihuiyu M2/M3 Nano, Moshiboard)' },
  { ...JCZ_LMC_USB_FILTER, label: 'Galvo controller (JCZ LMC, EZCad2)' },
];
