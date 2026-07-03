// Synthetic bed-with-alignment-markers renderer (ADR-108 harness): the frame a
// known camera records of a bed carrying the engraved marker pattern, so
// detectAlignMarkers is verified from pixels. Engraving contrast is moderate
// (dark burn on light material), unlike the printed board's near-black ink.
// Test fixture: imported only by tests, never by core.

import type { Vec2 } from '../scene';
import type { AlignMarkerLayout } from './align-markers';
import { projectBoard } from './calibrate-fixtures';
import type { GrayImage } from './corner-subpix';
import {
  PLANE_BACKGROUND_GRAY,
  type PlaneRenderCamera,
  renderPlaneView,
} from './plane-render-fixtures';

export type MarkerRenderOptions = PlaneRenderCamera & {
  readonly layout: AlignMarkerLayout;
  // Render the origin as a single patch (layout violation) for failure tests.
  readonly omitOriginPair?: boolean;
};

const BURN_GRAY = 60;
const MATERIAL_GRAY = 200;

/** Render the bed plane with the engraved marker patches. */
export function renderMarkerView(options: MarkerRenderOptions): GrayImage {
  const centers = patchCenters(options.layout, options.omitOriginPair === true);
  const square = options.layout.patchSquareMm;
  return renderPlaneView(options, (plane) => {
    for (const center of centers) {
      const shade = patchShade(plane, center, square);
      if (shade !== null) return shade;
    }
    return MATERIAL_GRAY;
  });
}

/**
 * Ground-truth marker TARGET pixels (TL, TR, BR, BL order). The origin truth
 * is the midpoint of the two projected patch centres — matching what the
 * detector computes — because under lens distortion the projection of a
 * midpoint is not the midpoint of the projections.
 */
export function trueMarkerPixels(options: MarkerRenderOptions): Vec2[] {
  const [origin, ...rest] = options.layout.targets;
  const half = options.layout.originPairSeparationMm / 2;
  const projected = projectBoard(options.k, options.d, options.rvec, options.tvec, [
    { x: origin.x - half, y: origin.y },
    { x: origin.x + half, y: origin.y },
    ...rest,
  ]);
  const [pairA, pairB, ...singles] = projected;
  if (pairA === undefined || pairB === undefined) return projected;
  return [{ x: (pairA.x + pairB.x) / 2, y: (pairA.y + pairB.y) / 2 }, ...singles];
}

function patchCenters(layout: AlignMarkerLayout, omitOriginPair: boolean): Vec2[] {
  const [origin, ...rest] = layout.targets;
  const half = layout.originPairSeparationMm / 2;
  const originPatches = omitOriginPair
    ? [origin]
    : [
        { x: origin.x - half, y: origin.y },
        { x: origin.x + half, y: origin.y },
      ];
  return [...originPatches, ...rest];
}

// A 2×2 checker patch centred on `center`: cells of `square` mm, diagonal
// cells burned. Returns null outside the patch (so the bed shows through) —
// the four-cell meeting point at the centre is the detected X-corner.
function patchShade(plane: Vec2, center: Vec2, square: number): number | null {
  const dx = plane.x - center.x;
  const dy = plane.y - center.y;
  if (Math.abs(dx) >= square || Math.abs(dy) >= square) return null;
  const cellX = dx < 0 ? 0 : 1;
  const cellY = dy < 0 ? 0 : 1;
  return cellX === cellY ? BURN_GRAY : MATERIAL_GRAY;
}

export { PLANE_BACKGROUND_GRAY };
