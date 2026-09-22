import type { Vec2 } from '../scene';
import type { DeviceProfile } from './device-profile';
import { machineBoundsForDevice } from './machine-bounds';

export type NativeXyBounds = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

/** Native controller MPos and profile bed numbers have separate zeros. Axis
 * direction is the explicit profile convention; this mapping never guesses
 * or reverses an axis from homing direction or the sign of a work offset. */
export type NativeBedFrame = {
  readonly nativeBounds: NativeXyBounds;
  readonly nativeToBedOffsetMm: Vec2;
};

export function nativeBedFrame(
  device: DeviceProfile,
  nativeBounds: NativeXyBounds,
): NativeBedFrame | null {
  const values = Object.values(nativeBounds);
  if (
    !values.every(Number.isFinite) ||
    !Number.isFinite(device.bedWidth) ||
    !Number.isFinite(device.bedHeight)
  )
    return null;
  // A configured travel different from the usable bed does not establish
  // where that smaller bed sits inside native travel. Do not invent it.
  if (
    Math.abs(nativeBounds.maxX - nativeBounds.minX - device.bedWidth) > 0.001 ||
    Math.abs(nativeBounds.maxY - nativeBounds.minY - device.bedHeight) > 0.001 ||
    device.bedWidth <= 0 ||
    device.bedHeight <= 0
  )
    return null;
  const bed = machineBoundsForDevice(device);
  return {
    nativeBounds,
    nativeToBedOffsetMm: { x: bed.minX - nativeBounds.minX, y: bed.minY - nativeBounds.minY },
  };
}

export function nativePointToBed(point: Vec2, frame: NativeBedFrame): Vec2 {
  return { x: point.x + frame.nativeToBedOffsetMm.x, y: point.y + frame.nativeToBedOffsetMm.y };
}

export function bedPointToNative(point: Vec2, frame: NativeBedFrame): Vec2 {
  return { x: point.x - frame.nativeToBedOffsetMm.x, y: point.y - frame.nativeToBedOffsetMm.y };
}
