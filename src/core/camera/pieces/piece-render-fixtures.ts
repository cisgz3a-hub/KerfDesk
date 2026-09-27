// Test support (ADR-442, ADR-443): pictures of blanks, or printed sheets with
// marks, lying on a honeycomb bed, either already flattened top-down or as a
// camera sees them. The camera picture back-projects every pixel through the
// real camera model at each piece's height, so the finders are tested on
// geometry, not on a shortcut. The first piece listed that covers a point is
// the one seen there. Not shipped code.

import type { BedArea } from '../model/camera-model-accuracy';
import { bedMapper, type CameraPose, type LensModel } from '../model/camera-model';
import type { RgbaImage } from '../rgba-image';
import type { Point } from './rotated-rect';

export type Colour = readonly [number, number, number];

export type RenderedPiece = (
  | {
      readonly kind: 'rect';
      readonly centre: Point;
      readonly length: number;
      readonly width: number;
      /** Direction of the long side, degrees, y down. */
      readonly angleDeg: number;
    }
  | { readonly kind: 'disc'; readonly centre: Point; readonly radius: number }
  | {
      readonly kind: 'ring';
      readonly centre: Point;
      readonly outerRadius: number;
      readonly innerRadius: number;
    }
  | { readonly kind: 'polygon'; readonly points: ReadonlyArray<Point> }
) & {
  readonly colour: Colour;
  /** Height of the piece's top in the camera picture, mm; the picture's thickness by default. */
  readonly topMm?: number;
};

export const PLYWOOD: Colour = [206, 168, 118];
/** Blue acrylic about as bright as the honeycomb looks once blurred. */
export const BLUE_ACRYLIC: Colour = [40, 90, 150];
const HONEYCOMB_WALL = 170;
const HONEYCOMB_HOLE = 34;
const HONEYCOMB_PITCH_MM = 6;
const SUPERSAMPLE = 2;

/** The bed seen top-down: output pixel (0, 0) is the region's top-left corner. */
export function renderBedPicture(args: {
  readonly region: BedArea;
  readonly pixelsPerMm: number;
  readonly pieces: ReadonlyArray<RenderedPiece>;
  readonly noise?: number;
}): RgbaImage {
  const { region, pixelsPerMm: ppm } = args;
  const width = Math.round(region.width * ppm);
  const height = Math.round(region.height * ppm);
  return render(width, height, args.noise ?? 0, (px, py) => {
    const x = region.x + px / ppm;
    const y = region.y + py / ppm;
    return pieceColour(args.pieces, x, y) ?? honeycomb(x, y);
  });
}

/** What the camera sees with every piece `thicknessMm` tall, unless it has its own top. */
export function renderCameraPicture(args: {
  readonly lens: LensModel;
  readonly pose: CameraPose;
  readonly pieces: ReadonlyArray<RenderedPiece>;
  readonly thicknessMm: number;
  readonly noise?: number;
}): RgbaImage {
  const toBed = bedMapper(args.lens, args.pose);
  const { imageWidth: width, imageHeight: height } = args.lens;
  const byHeight = [...args.pieces].sort(
    (a, b) => (b.topMm ?? args.thicknessMm) - (a.topMm ?? args.thicknessMm),
  );
  return render(width, height, args.noise ?? 0, (px, py) => {
    // Pixel centres sit at integer coordinates in the camera model.
    const pixel = { x: px - 0.5, y: py - 0.5 };
    // The highest top a ray meets first hides the rest.
    for (const piece of byHeight) {
      const top = toBed(pixel, piece.topMm ?? args.thicknessMm);
      if (top !== null && covers(piece, top.x, top.y)) return piece.colour;
    }
    const bed = toBed(pixel, 0);
    return bed === null
      ? [HONEYCOMB_HOLE, HONEYCOMB_HOLE, HONEYCOMB_HOLE]
      : honeycomb(bed.x, bed.y);
  });
}

type Shade = (px: number, py: number) => Colour;

// Supersampled; `shade` takes pixel-corner coordinates.
function render(width: number, height: number, noise: number, shade: Shade): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  let seed = 4242;
  const random = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sum = [0, 0, 0];
      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const colour = shade(x + (sx + 0.5) / SUPERSAMPLE, y + (sy + 0.5) / SUPERSAMPLE);
          for (let c = 0; c < 3; c += 1) sum[c] = (sum[c] ?? 0) + (colour[c] ?? 0);
        }
      }
      const offset = (y * width + x) * 4;
      const grain = noise === 0 ? 0 : noise * gaussian(random);
      for (let c = 0; c < 3; c += 1) data[offset + c] = (sum[c] ?? 0) / SUPERSAMPLE ** 2 + grain;
      data[offset + 3] = 255;
    }
  }
  return { data, width, height };
}

function pieceColour(pieces: ReadonlyArray<RenderedPiece>, x: number, y: number): Colour | null {
  for (const piece of pieces) {
    if (covers(piece, x, y)) return piece.colour;
  }
  return null;
}

function covers(piece: RenderedPiece, x: number, y: number): boolean {
  if (piece.kind === 'ring') {
    const d = Math.hypot(x - piece.centre.x, y - piece.centre.y);
    return d >= piece.innerRadius && d <= piece.outerRadius;
  }
  if (piece.kind === 'disc')
    return Math.hypot(x - piece.centre.x, y - piece.centre.y) <= piece.radius;
  if (piece.kind === 'polygon') return insidePolygon(piece.points, x, y);
  const rad = (piece.angleDeg * Math.PI) / 180;
  const dx = x - piece.centre.x;
  const dy = y - piece.centre.y;
  const u = dx * Math.cos(rad) + dy * Math.sin(rad);
  const v = -dx * Math.sin(rad) + dy * Math.cos(rad);
  return Math.abs(u) <= piece.length / 2 && Math.abs(v) <= piece.width / 2;
}

function insidePolygon(points: ReadonlyArray<Point>, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[i];
    const b = points[j];
    if (a === undefined || b === undefined) continue;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** `points` turned by `deg` about the origin and moved to `centre`. */
export function placedPolygon(points: ReadonlyArray<Point>, centre: Point, deg: number): Point[] {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return points.map((p) => ({
    x: centre.x + p.x * cos - p.y * sin,
    y: centre.y + p.x * sin + p.y * cos,
  }));
}

// Hexagonal holes separated by thin bright walls, as on most laser beds.
function honeycomb(x: number, y: number): Colour {
  const rowHeight = (HONEYCOMB_PITCH_MM * Math.sqrt(3)) / 2;
  const row = Math.round(y / rowHeight);
  const offset = row % 2 === 0 ? 0 : HONEYCOMB_PITCH_MM / 2;
  const col = Math.round((x - offset) / HONEYCOMB_PITCH_MM);
  const d = Math.hypot(x - (col * HONEYCOMB_PITCH_MM + offset), y - row * rowHeight);
  const grey = d < HONEYCOMB_PITCH_MM * 0.42 ? HONEYCOMB_HOLE : HONEYCOMB_WALL;
  return [grey, grey, grey];
}

function gaussian(random: () => number): number {
  return Math.sqrt(-2 * Math.log(random() + 1e-12)) * Math.cos(2 * Math.PI * random());
}
