import type { DeviceProfile } from './device-profile';

export type MachineBounds = {
  readonly width: number;
  readonly height: number;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

export function machineBoundsForDevice(device: DeviceProfile): MachineBounds {
  if (device.origin === 'center') {
    return {
      width: device.bedWidth,
      height: device.bedHeight,
      minX: -device.bedWidth / 2,
      minY: -device.bedHeight / 2,
      maxX: device.bedWidth / 2,
      maxY: device.bedHeight / 2,
    };
  }
  return {
    width: device.bedWidth,
    height: device.bedHeight,
    minX: 0,
    minY: 0,
    maxX: device.bedWidth,
    maxY: device.bedHeight,
  };
}
