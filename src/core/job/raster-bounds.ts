// raster-bounds — a raster image's axis-aligned bounding box in MACHINE
// coordinates (object transform + device origin applied). Extracted from
// compile-job so the pre-emit budget guard (roadmap P1-A) can size a raster
// WITHOUT running the full compile + its large allocations. Pure-core.

import { type DeviceProfile, toMachineCoords } from '../devices';
import { applyTransform, type RasterImage } from '../scene';

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
  const corners = [
    { x: obj.bounds.minX, y: obj.bounds.minY },
    { x: obj.bounds.maxX, y: obj.bounds.minY },
    { x: obj.bounds.maxX, y: obj.bounds.maxY },
    { x: obj.bounds.minX, y: obj.bounds.maxY },
  ].map((p) => toMachineCoords(applyTransform(p, obj.transform), device));
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}
