// The USB laser controllers the desktop app lets its window open (ADR-702).
// The main process cannot import src/, so this mirrors
// src/core/controllers/usb/laser-usb-devices.ts; laser-usb-devices.test.ts
// holds the two equal.

export type LaserUsbDevice = {
  readonly vendorId: number;
  readonly productId: number;
  readonly label: string;
};

export const LASER_USB_DEVICES: ReadonlyArray<LaserUsbDevice> = [
  {
    vendorId: 0x1a86,
    productId: 0x5512,
    label: 'K40 controller (CH341: Lihuiyu M2/M3 Nano, Moshiboard)',
  },
  { vendorId: 0x9588, productId: 0x9899, label: 'Galvo controller (JCZ LMC, EZCad2)' },
];

export function laserUsbDevice(device: {
  readonly vendorId: number;
  readonly productId: number;
}): LaserUsbDevice | undefined {
  return LASER_USB_DEVICES.find(
    (known) => known.vendorId === device.vendorId && known.productId === device.productId,
  );
}
