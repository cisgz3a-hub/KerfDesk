import type { DeviceProfile } from '../devices';

/** True when the device origin reverses raster columns in machine space. */
export function originFlipsRasterX(device: DeviceProfile): boolean {
  return device.origin === 'front-right' || device.origin === 'rear-right';
}

/** True when the device origin reverses raster rows in machine space. */
export function originFlipsRasterY(device: DeviceProfile): boolean {
  return (
    device.origin === 'front-left' || device.origin === 'front-right' || device.origin === 'center'
  );
}
