import {
  MAX_BOARD_OUTLINE_POINTS,
  normalizeBoardOutline,
  pointInPolygon,
  simplifyClosedOutline,
  type Vec2,
} from '../../scene';
import { findPieces, MIN_PIECE_AREA_MM2 } from '../pieces/find-pieces';
import type { BedArea } from '../model/camera-model-accuracy';
import type { RgbaImage } from '../rgba-image';
import type { Mat3 } from '../homography';

const NOT_FOUND =
  'No board was found where you clicked. Click the middle of the board, away from the reference sheet.';
const UNCLEAN =
  'The board outline could not be traced cleanly. Retake the photo with the board against a plain, contrasting background.';

export function traceBoardOutline(args: {
  readonly rectified: RgbaImage;
  readonly region: BedArea;
  readonly pixelsPerMm: number;
  readonly tapMm: Vec2;
}):
  | { readonly ok: true; readonly outlineMm: Vec2[]; readonly partial: boolean }
  | { readonly ok: false; readonly reason: string } {
  const pieces = findPieces({
    image: args.rectified,
    region: args.region,
    pixelsPerMm: args.pixelsPerMm,
    reference: args.tapMm,
    minAreaMm2: MIN_PIECE_AREA_MM2,
  });
  const piece = pieces.find((candidate) => pointInPolygon(args.tapMm, candidate.outline));
  if (piece === undefined) return { ok: false, reason: NOT_FOUND };
  let tolerance = Math.max(0.5, 1 / args.pixelsPerMm);
  let simplified = simplifyClosedOutline(piece.outline, tolerance);
  while (simplified.length > MAX_BOARD_OUTLINE_POINTS) {
    tolerance *= 1.5;
    simplified = simplifyClosedOutline(piece.outline, tolerance);
  }
  const outlineMm = normalizeBoardOutline(simplified);
  return outlineMm === null
    ? { ok: false, reason: UNCLEAN }
    : { ok: true, outlineMm, partial: piece.partial };
}

export function straightDownToMm(imageWidth: number, imageHeight: number): Mat3 {
  const pixelsPerMm = Math.max(imageWidth, imageHeight) / 400;
  const scale = pixelsPerMm > 0 ? 1 / pixelsPerMm : 1;
  return [scale, 0, 0, 0, scale, 0, 0, 0, 1];
}
