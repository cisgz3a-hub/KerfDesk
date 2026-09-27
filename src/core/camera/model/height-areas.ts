// Height areas (ADR-441 Amendment 2): rectangles of the bed whose top surface
// stands at its own height, such as a box beside a thin sheet. The camera sees
// each object's top from its own height, so one material height can only line
// up one of them; with areas, the overlay and the trace correct every object
// to its own top. Where areas overlap the highest wins, because that is the
// surface the camera looks down onto. Pure core.

import type { BedArea } from './camera-model-accuracy';

export type SurfaceHeightArea = BedArea & {
  readonly id: string;
  /** Height of this area's top surface above the bed, mm. */
  readonly surfaceHeightMm: number;
};

/** True when bed point (x, y) lies in `area`, edges included. */
export function areaContains(area: BedArea, x: number, y: number): boolean {
  return x >= area.x && x <= area.x + area.width && y >= area.y && y <= area.y + area.height;
}

/**
 * Height of the surface the camera sees at bed point (x, y): the highest area
 * that contains it, or `fallbackMm` (the material height) outside every area.
 * An area lower than the material height still wins inside itself, so an
 * opening cut through the sheet can show the bed below.
 */
export function surfaceHeightAt(
  areas: ReadonlyArray<SurfaceHeightArea>,
  x: number,
  y: number,
  fallbackMm: number,
): number {
  let highest: number | null = null;
  for (const area of areas) {
    if (!areaContains(area, x, y)) continue;
    if (highest === null || area.surfaceHeightMm > highest) highest = area.surfaceHeightMm;
  }
  return highest ?? fallbackMm;
}

/**
 * The areas in painting order: lowest first, so drawing each over the last
 * leaves the highest on top wherever they overlap. Equal heights keep their
 * order (Array.prototype.sort is stable).
 */
export function areasLowestFirst(
  areas: ReadonlyArray<SurfaceHeightArea>,
): ReadonlyArray<SurfaceHeightArea> {
  return [...areas].sort((a, b) => a.surfaceHeightMm - b.surfaceHeightMm);
}

/** The part of `area` that lies on a bed of the given size, or null when none does. */
export function clipAreaToBed(
  area: BedArea,
  bedWidthMm: number,
  bedHeightMm: number,
): BedArea | null {
  const minX = Math.max(area.x, 0);
  const minY = Math.max(area.y, 0);
  const maxX = Math.min(area.x + area.width, bedWidthMm);
  const maxY = Math.min(area.y + area.height, bedHeightMm);
  if (!(maxX > minX && maxY > minY)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * A new area around a box of the design, grown by `marginMm` on every side
 * and cut to the bed. The margin is there because the object's top is almost
 * always larger than the artwork placed on it. Null when the box misses the bed.
 */
export function heightAreaAround(args: {
  readonly id: string;
  readonly bounds: {
    readonly minX: number;
    readonly minY: number;
    readonly maxX: number;
    readonly maxY: number;
  };
  readonly marginMm: number;
  readonly surfaceHeightMm: number;
  readonly bedWidthMm: number;
  readonly bedHeightMm: number;
}): SurfaceHeightArea | null {
  const { bounds, marginMm } = args;
  const grown: BedArea = {
    x: bounds.minX - marginMm,
    y: bounds.minY - marginMm,
    width: bounds.maxX - bounds.minX + 2 * marginMm,
    height: bounds.maxY - bounds.minY + 2 * marginMm,
  };
  const clipped = clipAreaToBed(grown, args.bedWidthMm, args.bedHeightMm);
  if (clipped === null) return null;
  return { id: args.id, ...clipped, surfaceHeightMm: args.surfaceHeightMm };
}
