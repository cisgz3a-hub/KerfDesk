// Find the separate pieces lying on the bed in a flattened camera picture
// (ADR-442): blanks, offcuts, coasters. Each piece comes back in bed mm with
// its outline, its smallest rotated rectangle, and the cues that fix its
// orientation: whether it is round, square or oblong, and which way its mass
// leans when it is lopsided. Pieces are ordered in rows, top to bottom and
// left to right. Nothing here guesses what a piece is. Pure core.

import type { BedArea } from '../model/camera-model-accuracy';
import type { RgbaImage } from '../rgba-image';
import { pieceComponents, type PieceComponent } from './piece-components';
import { pieceImage } from './piece-image';
import { pieceMask, type PixelPoint } from './piece-mask';
import { minAreaRect, snugRect, type Point, type RotatedRect } from './rotated-rect';

export type PieceShape = 'round' | 'square' | 'oblong';

export type DetectedPiece = {
  /** Outer outline, bed mm, closed without repeating the first point. */
  readonly outline: ReadonlyArray<Point>;
  /** The rotated rectangle the piece fills, its straight sides on the edges' medians, bed mm. */
  readonly rect: RotatedRect;
  readonly areaMm2: number;
  /** Centre of the piece's own area, holes left out, bed mm. */
  readonly centroid: Point;
  readonly shape: PieceShape;
  /**
   * Direction from the rectangle's centre to the centroid, degrees in
   * [0, 360), y down; null when the piece is too even for it to mean anything.
   */
  readonly headingDeg: number | null;
  /** True when part of the piece lies outside what the camera saw. */
  readonly partial: boolean;
};

export type FindPiecesInput = {
  /** The bed pictured top-down, as `warpFrameToBedImage` makes it. */
  readonly image: RgbaImage;
  /** The part of the bed the picture covers, mm. */
  readonly region: BedArea;
  readonly pixelsPerMm: number;
  /**
   * A bed point whose colour the pieces are told apart by, usually the
   * design's centre; null splits the picture by brightness instead.
   */
  readonly reference: Point | null;
  /** Smaller pieces are left out, mm². */
  readonly minAreaMm2: number;
};

/** Default smallest piece: a 10 mm square. */
export const MIN_PIECE_AREA_MM2 = 100;
// Specks and hairline gaps narrower than this are cleaned away.
const CLEAN_RADIUS_MM = 1;
// Long side over short side below this reads as square.
const SQUARISH_RATIO = 1.08;
// A square piece filling less of its rectangle than this is round (a disc
// fills π/4, about 0.785; a square fills 1).
const ROUND_FILL = 0.86;
// A centroid this far from the rectangle's centre gives the piece a heading.
const HEADING_MIN_MM = 0.5;
const HEADING_LENGTH_FRACTION = 0.02;

export function findPieces(input: FindPiecesInput): DetectedPiece[] {
  const ppm = input.pixelsPerMm;
  const image = pieceImage(input.image, ppm);
  const mask = pieceMask(image, referencePixel(input));
  const minPixels = Math.max(1, input.minAreaMm2 * ppm * ppm);
  const components = pieceComponents(mask, image.visible, CLEAN_RADIUS_MM * ppm, minPixels);
  const pieces = components.flatMap((component) => {
    const piece = toPiece(component, input.region, ppm);
    return piece === null ? [] : [piece];
  });
  return inRows(pieces);
}

function referencePixel(input: FindPiecesInput): PixelPoint | null {
  if (input.reference === null) return null;
  const x = (input.reference.x - input.region.x) * input.pixelsPerMm - 0.5;
  const y = (input.reference.y - input.region.y) * input.pixelsPerMm - 0.5;
  const inside = x >= 0 && y >= 0 && x <= input.image.width - 1 && y <= input.image.height - 1;
  return inside ? { x, y } : null;
}

function toPiece(component: PieceComponent, region: BedArea, ppm: number): DetectedPiece | null {
  const toBed = (p: PixelPoint): Point => ({ x: region.x + p.x / ppm, y: region.y + p.y / ppm });
  const outline = component.outline.map(toBed);
  const edge = component.edgePoints.map(toBed);
  const smallest = minAreaRect(edge);
  if (smallest === null || !(smallest.width > 0)) return null;
  const rect = snugRect(smallest, edge);
  const areaMm2 = component.pixels / (ppm * ppm);
  const centroid = toBed(component.centroid);
  return {
    outline,
    rect,
    areaMm2,
    centroid,
    shape: shapeOf(rect, areaMm2),
    headingDeg: headingOf(rect, centroid),
    partial: component.partial,
  };
}

function shapeOf(rect: RotatedRect, areaMm2: number): PieceShape {
  if (rect.length / rect.width >= SQUARISH_RATIO) return 'oblong';
  return areaMm2 / (rect.length * rect.width) < ROUND_FILL ? 'round' : 'square';
}

function headingOf(rect: RotatedRect, centroid: Point): number | null {
  const dx = centroid.x - rect.centre.x;
  const dy = centroid.y - rect.centre.y;
  const limit = Math.max(HEADING_MIN_MM, HEADING_LENGTH_FRACTION * rect.length);
  if (Math.hypot(dx, dy) <= limit) return null;
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  return deg < 0 ? deg + 360 : deg;
}

// Rows: sorted by centre height, a piece joins the row whose first piece's
// half-height reaches it; each row then runs left to right.
function inRows(pieces: ReadonlyArray<DetectedPiece>): DetectedPiece[] {
  const sorted = [...pieces].sort((a, b) => a.rect.centre.y - b.rect.centre.y);
  const rows: DetectedPiece[][] = [];
  let reach = -Infinity;
  for (const piece of sorted) {
    const row = rows[rows.length - 1];
    if (row !== undefined && piece.rect.centre.y <= reach) {
      row.push(piece);
      continue;
    }
    rows.push([piece]);
    reach = piece.rect.centre.y + halfHeight(piece);
  }
  return rows.flatMap((row) => row.sort((a, b) => a.rect.centre.x - b.rect.centre.x));
}

function halfHeight(piece: DetectedPiece): number {
  let min = Infinity;
  let max = -Infinity;
  for (const p of piece.outline) {
    min = Math.min(min, p.y);
    max = Math.max(max, p.y);
  }
  return (max - min) / 2;
}
