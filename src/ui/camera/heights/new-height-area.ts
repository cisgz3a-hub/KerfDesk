// Where a new height area starts (ADR-441 Amendment 2): around the selected
// objects when there are any, because artwork is usually placed on the object
// whose height it needs, otherwise a square in the middle of the bed that the
// operator moves with the X and Y fields.

import { heightAreaAround, type SurfaceHeightArea } from '../../../core/camera/model/height-areas';

/** An object's top is almost always larger than the artwork placed on it. */
export const SELECTION_MARGIN_MM = 10;
const DEFAULT_SIZE_MM = 100;

export function newHeightArea(args: {
  readonly id: string;
  readonly selectionBounds: {
    readonly minX: number;
    readonly minY: number;
    readonly maxX: number;
    readonly maxY: number;
  } | null;
  readonly surfaceHeightMm: number;
  readonly bedWidthMm: number;
  readonly bedHeightMm: number;
}): SurfaceHeightArea | null {
  const common = {
    id: args.id,
    surfaceHeightMm: args.surfaceHeightMm,
    bedWidthMm: args.bedWidthMm,
    bedHeightMm: args.bedHeightMm,
  };
  if (args.selectionBounds !== null) {
    const around = heightAreaAround({
      ...common,
      bounds: args.selectionBounds,
      marginMm: SELECTION_MARGIN_MM,
    });
    if (around !== null) return around;
  }
  const half = Math.min(DEFAULT_SIZE_MM, args.bedWidthMm, args.bedHeightMm) / 2;
  const cx = args.bedWidthMm / 2;
  const cy = args.bedHeightMm / 2;
  return heightAreaAround({
    ...common,
    bounds: { minX: cx - half, minY: cy - half, maxX: cx + half, maxY: cy + half },
    marginMm: 0,
  });
}
