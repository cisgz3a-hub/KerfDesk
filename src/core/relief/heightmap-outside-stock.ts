// The stock beyond a relief map's edge (ADR-412 Amendment 2).
//
// A relief is carved inside its own footprint only. Whatever lies past the
// map's physical edge (bare stock, a neighbouring relief on any layer or
// operation, a part the job keeps) stands at the stock top, exactly like an
// excluded mask cell (relief-mask-stock.ts): a cutter whose axis stands d from
// it needs its tip at top - dz(d - clearance) or above. It used to count as
// bottomless, so a cutter riding the map's last sample reached a full radius
// past the footprint (audit 2026-09-29 P2-relief-rough-3, meta v1 M7-P1-1).
//
// The edge is the map's physical rectangle, so a shortened terminal cell
// (heightmap.ts) needs no special case: the nearest outside point to any
// point of the map lies straight across its nearest side.

import { CNC_MASK_EMISSION_Z_CLEARANCE_MM } from '../cnc/cnc-output-precision';
import { partialCellCenter } from '../grid';
import type { ToolKernel } from '../sim';
import type { Heightmap } from './heightmap';
import type { Rectangle } from './relief-mask-stock-move';

const TOOL_DISTANCE_TOLERANCE_ULPS = 16;
// The strips past each side reach this much further than the cutter can.
const STRIP_MARGIN_MM = 1;

type MapExtent = Pick<Heightmap, 'widthMm' | 'heightMm'>;

/** Distance in mm from (x, y), in map mm, to the nearest point past the map's edge. */
export function outsideStockDistanceMm(map: MapExtent, x: number, y: number): number {
  return Math.max(0, Math.min(x, map.widthMm - x, y, map.heightMm - y));
}

/**
 * The lowest tip, before the stock-top cap every tip takes, a cutter centred
 * on sample (cx, cy) may stand at without cutting past the map's edge. It uses
 * the excluded cells' law and path uncertainty (heightmap-tool-offset.ts), so
 * the widened roughing kernel covers its rings here as it does beside a mask.
 */
export function outsideStockConstraint(
  map: Heightmap,
  kernel: ToolKernel,
  cx: number,
  cy: number,
): number {
  const distanceMm = Math.max(
    0,
    outsideStockDistanceMm(map, partialCellCenter(map, 'x', cx), partialCellCenter(map, 'y', cy)) -
      kernel.maskPathUncertaintyMm,
  );
  const tolerance =
    TOOL_DISTANCE_TOLERANCE_ULPS * Number.EPSILON * Math.max(1, kernel.radiusMm, kernel.mmPerCell);
  if (distanceMm > kernel.radiusMm + tolerance) return Number.NEGATIVE_INFINITY;
  return (
    CNC_MASK_EMISSION_Z_CLEARANCE_MM -
    kernel.surfaceDzAtRadius(Math.min(kernel.radiusMm, distanceMm))
  );
}

/**
 * The outside as four strips, one past each side, deep enough that every
 * outside point a cutter in the map can reach (`reachMm`) lies in one. Each is
 * convex, so a straight move is checked against it exactly
 * (relief-mask-stock-move.ts).
 */
export function outsideStockStrips(map: MapExtent, reachMm: number): ReadonlyArray<Rectangle> {
  const depth = reachMm + STRIP_MARGIN_MM;
  const { widthMm: w, heightMm: h } = map;
  return [
    { x0: -depth, x1: 0, y0: -depth, y1: h + depth },
    { x0: w, x1: w + depth, y0: -depth, y1: h + depth },
    { x0: -depth, x1: w + depth, y0: -depth, y1: 0 },
    { x0: -depth, x1: w + depth, y0: h, y1: h + depth },
  ];
}
