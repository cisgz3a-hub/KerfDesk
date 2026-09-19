import type { Bounds } from '../../core/scene';

const INVALID_BOUNDS: Bounds = { minX: NaN, minY: NaN, maxX: NaN, maxY: NaN };

/** Give a zero-width/height vector one physical pixel, centred on its axis. */
export function bitmapConversionBounds(bounds: Bounds, linesPerMm: number): Bounds {
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  if (!validBounds(bounds, width, height, linesPerMm)) return INVALID_BOUNDS;
  if (width > 0 && height > 0) return bounds;
  const halfPitch = 0.5 / linesPerMm;
  const expanded = {
    minX: bounds.minX - (width === 0 ? halfPitch : 0),
    maxX: bounds.maxX + (width === 0 ? halfPitch : 0),
    minY: bounds.minY - (height === 0 ? halfPitch : 0),
    maxY: bounds.maxY + (height === 0 ? halfPitch : 0),
  };
  // Extreme coordinates can make a pitch unrepresentable. Do not approve a
  // still-degenerate image or silently move it to a different coordinate.
  return Object.values(expanded).every(Number.isFinite) &&
    expanded.maxX > expanded.minX &&
    expanded.maxY > expanded.minY
    ? expanded
    : INVALID_BOUNDS;
}

function validBounds(bounds: Bounds, width: number, height: number, linesPerMm: number): boolean {
  return (
    [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY, width, height, linesPerMm].every(
      Number.isFinite,
    ) &&
    width >= 0 &&
    height >= 0 &&
    linesPerMm > 0
  );
}
