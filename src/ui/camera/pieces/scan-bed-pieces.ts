// A camera frame flattened onto the bed with the saved camera model, at the
// material height and each height area's own height, then searched for
// pieces (ADR-442). The picture is coarser than a trace: pieces are found by
// their edges averaged over whole sides, so 2 px/mm places them to a fraction
// of a millimetre while keeping the search quick on a large bed.

import { warpFrameToBedImage } from '../../../core/camera/model/bed-image';
import type { CameraPose, LensModel } from '../../../core/camera/model/camera-model';
import type { SurfaceHeightArea } from '../../../core/camera/model/height-areas';
import {
  findPieces,
  MIN_PIECE_AREA_MM2,
  type DetectedPiece,
} from '../../../core/camera/pieces/find-pieces';
import type { Point } from '../../../core/camera/pieces/rotated-rect';
import type { RgbaImage } from '../../../core/camera/rgba-image';

export const PIECE_PIXELS_PER_MM = 2;
// Beds larger than about 700 × 700 mm are pictured a little coarser.
const PIECE_PIXEL_BUDGET = 2_000_000;

export function piecePixelsPerMm(bedWidthMm: number, bedHeightMm: number): number {
  const areaMm2 = bedWidthMm * bedHeightMm;
  if (!(areaMm2 > 0)) return PIECE_PIXELS_PER_MM;
  return Math.min(PIECE_PIXELS_PER_MM, Math.sqrt(PIECE_PIXEL_BUDGET / areaMm2));
}

/** The pieces on the bed, or null when the frame could not be flattened. */
export function scanBedPieces(args: {
  readonly raw: RgbaImage;
  readonly lens: LensModel;
  readonly pose: CameraPose;
  readonly bedWidthMm: number;
  readonly bedHeightMm: number;
  readonly surfaceHeightMm: number;
  readonly heightAreas: ReadonlyArray<SurfaceHeightArea>;
  /** A bed point on a piece or on the bed whose colour tells the two apart. */
  readonly reference: Point | null;
}): DetectedPiece[] | null {
  const region = { x: 0, y: 0, width: args.bedWidthMm, height: args.bedHeightMm };
  const pixelsPerMm = piecePixelsPerMm(args.bedWidthMm, args.bedHeightMm);
  const image = warpFrameToBedImage(args.raw, args.lens, args.pose, {
    region,
    pixelsPerMm,
    surfaceHeightMm: args.surfaceHeightMm,
    heightAreas: args.heightAreas,
  });
  if (image === null) return null;
  return findPieces({
    image,
    region,
    pixelsPerMm,
    reference: args.reference,
    minAreaMm2: MIN_PIECE_AREA_MM2,
  });
}
