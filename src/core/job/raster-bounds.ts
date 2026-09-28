// raster-bounds — a raster image's axis-aligned bounding box in MACHINE
// coordinates (object transform + device origin applied). Extracted from
// compile-job so the pre-emit budget guard (roadmap P1-A) can size a raster
// WITHOUT running the full compile + its large allocations. Pure-core.

import { type DeviceProfile, toMachineCoords } from '../devices';
import { isAlongXScan, scanFrameBoundsOf, type RasterScanFrame } from '../raster/raster-scan-frame';
import { applyTransform, type RasterImage, type Vec2 } from '../scene';

export type RasterMachineBounds = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

export function rasterBoundsInMachineCoords(
  obj: RasterImage,
  device: DeviceProfile,
): RasterMachineBounds {
  const corners = rasterMachineCorners(obj, device);
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

/**
 * ADR-492: the box around the image in its scan frame, where rows run along X.
 * Along X it is exactly rasterBoundsInMachineCoords.
 */
export function rasterScanBounds(
  obj: RasterImage,
  device: DeviceProfile,
  frame: RasterScanFrame,
): RasterMachineBounds {
  if (isAlongXScan(frame)) return rasterBoundsInMachineCoords(obj, device);
  return scanFrameBoundsOf(frame, rasterMachineCorners(obj, device));
}

function rasterMachineCorners(obj: RasterImage, device: DeviceProfile): Vec2[] {
  return [
    { x: obj.bounds.minX, y: obj.bounds.minY },
    { x: obj.bounds.maxX, y: obj.bounds.minY },
    { x: obj.bounds.maxX, y: obj.bounds.maxY },
    { x: obj.bounds.minX, y: obj.bounds.maxY },
  ].map((p) => toMachineCoords(applyTransform(p, obj.transform), device));
}
