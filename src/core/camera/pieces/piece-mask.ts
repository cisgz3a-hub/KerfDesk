// Which bed pixels belong to a piece (ADR-442, Amendment 2). Two colours are
// measured first: the bed's, from the band along the picture's edge (the bed
// surrounds the pieces), and the pieces', from the reference point when it
// sits on a piece, otherwise from the most common colour that stands out
// from the bed. Each unblurred pixel is then placed on the line from the bed's
// colour to the pieces' and clamped to it, 0 for the bed and 1 for a piece,
// so anything past the bed's end (a shadow, a scorch mark, an old cut) counts
// exactly as bed and can neither grow a piece nor become one. That value is
// blurred only as much as the bed's own texture needs (a honeycomb's walls,
// not a flat spoilboard), so blanks a millimetre or two apart stay apart, and
// the split is halfway between the bed's and the pieces' blurred levels, so a
// blurred straight edge stays where it really is. Pure core.

import type { RgbaImage } from '../rgba-image';
import { blurVisible, pieceImage, PIECE_BLUR_RADIUS_MM, type PieceImage } from './piece-image';

export type Colour = readonly [number, number, number];

export type PieceMask = {
  readonly width: number;
  readonly height: number;
  /** 1 on a piece. */
  readonly on: Uint8Array;
  /** The value each pixel was split by, and where the split is, for finding edges between pixels. */
  readonly feature: Float32Array;
  readonly threshold: number;
  /** Unblurred colour, three floats per pixel. */
  readonly rgb: Float32Array;
  /** The bed's colour and the pieces' colour the picture was split between; null when no piece stands out. */
  readonly bedColour: Colour | null;
  readonly pieceColour: Colour | null;
};

export type PixelPoint = { readonly x: number; readonly y: number };

// The bed's colour is read from a band this wide along the picture's edge.
const BORDER_MM = 4;
// Colour of the reference: the mean over this many pixels either side of it.
const REFERENCE_RADIUS_PX = 3;
// A colour this far from the bed's (0..255 per channel) stands out from it,
// and never less than this many times the bed's own spread.
const MIN_CONTRAST = 12;
const CONTRAST_OVER_SPREAD = 4;
// Pieces darker than the bed are taken only when they outnumber the brighter
// ones this many times: scorch marks and shadows are darker than most beds.
const DARK_SIDE_MAJORITY = 2;
// Blur radii tried in turn, mm; the first that keeps the bed's brightest
// texture clear of the split is used.
const BLUR_RADII_MM = [0.5, 1, 1.5, PIECE_BLUR_RADIUS_MM];
// The bed's texture must stay this share of the bed-to-piece step below the split.
const TEXTURE_MARGIN = 0.1;
const TEXTURE_QUANTILE = 0.995;
// Fewer standing-out pixels than this many mm² is no piece at all.
const MIN_PIECE_PIXELS_MM2 = 25;

export function pieceMask(
  raw: RgbaImage,
  pixelsPerMm: number,
  reference: PixelPoint | null,
): PieceMask {
  const coarse = pieceImage(raw, pixelsPerMm);
  const { width, height, visible } = coarse;
  const rgb = rawColour(raw);
  const band = borderBand(visible, width, height, Math.round(BORDER_MM * pixelsPerMm));
  const bed = medianColour(coarse.rgb, band);
  const contrast = bed === null ? 0 : minContrast(coarse.rgb, band, bed);
  const piece = bed === null ? null : pieceColour(coarse, bed, contrast, reference, pixelsPerMm);
  if (bed === null || piece === null) return emptyMask(width, height, rgb, bed);
  const along = alongBedToPiece(rgb, visible, bed, piece);
  const levels = {
    bed: spread(band.filter((i) => distance(coarse.rgb, i, bed) < contrast)),
    piece: spread(nearColour(coarse, piece, bed)),
  };
  const { feature, threshold } = leastBlur(along, coarse, levels, pixelsPerMm);
  const on = new Uint8Array(width * height);
  for (let i = 0; i < on.length; i += 1) {
    on[i] = visible[i] === 1 && (feature[i] ?? 0) > threshold ? 1 : 0;
  }
  return { width, height, on, feature, threshold, rgb, bedColour: bed, pieceColour: piece };
}

function emptyMask(width: number, height: number, rgb: Float32Array, bed: Colour | null) {
  const n = width * height;
  return {
    width,
    height,
    on: new Uint8Array(n),
    feature: new Float32Array(n),
    threshold: 0.5,
    rgb,
    bedColour: bed,
    pieceColour: null,
  };
}

function rawColour(raw: RgbaImage): Float32Array {
  const n = raw.width * raw.height;
  const rgb = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) {
    rgb[i * 3] = raw.data[i * 4] ?? 0;
    rgb[i * 3 + 1] = raw.data[i * 4 + 1] ?? 0;
    rgb[i * 3 + 2] = raw.data[i * 4 + 2] ?? 0;
  }
  return rgb;
}

// Visible pixels within `depth` of the picture's edge.
function borderBand(visible: Uint8Array, width: number, height: number, depth: number): number[] {
  const d = Math.max(1, Math.min(depth, Math.floor(Math.min(width, height) / 4)));
  const band: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const near = x < d || y < d || x >= width - d || y >= height - d;
      if (near && visible[y * width + x] === 1) band.push(y * width + x);
    }
  }
  return band;
}

function medianColour(rgb: Float32Array, pixels: ReadonlyArray<number>): Colour | null {
  if (pixels.length === 0) return null;
  const some = spread(pixels);
  const channel = (c: number): number =>
    quantile(
      some.map((i) => rgb[i * 3 + c] ?? 0),
      0.5,
    );
  return [channel(0), channel(1), channel(2)];
}

function minContrast(rgb: Float32Array, band: ReadonlyArray<number>, bed: Colour): number {
  const typical = quantile(
    spread(band).map((i) => distance(rgb, i, bed)),
    0.5,
  );
  return Math.max(MIN_CONTRAST, CONTRAST_OVER_SPREAD * typical);
}

/**
 * The pieces' colour: the reference's when it stands out from the bed (the
 * design sits on a piece), otherwise the most common standing-out colour,
 * taken from the pixels that stand out most; null when nothing does.
 */
function pieceColour(
  coarse: PieceImage,
  bed: Colour,
  contrast: number,
  reference: PixelPoint | null,
  pixelsPerMm: number,
): Colour | null {
  const atReference = reference === null ? null : meanColour(coarse, reference);
  if (atReference !== null && colourDistance(atReference, bed) > contrast) return atReference;
  const side = standingOutSide(coarse, bed, contrast);
  if (side.length < MIN_PIECE_PIXELS_MM2 * pixelsPerMm * pixelsPerMm) return null;
  const some = spread(side);
  const far = some.map((i) => distance(coarse.rgb, i, bed));
  const cut = quantile(far, 0.9) / 2;
  return medianColour(
    coarse.rgb,
    some.filter((_, k) => (far[k] ?? 0) >= cut),
  );
}

// The pixels standing out from the bed on its brighter side, or on its darker
// side when those outnumber them DARK_SIDE_MAJORITY times.
function standingOutSide(coarse: PieceImage, bed: Colour, contrast: number): number[] {
  const bright: number[] = [];
  const dark: number[] = [];
  const bedLuma = luma(bed[0], bed[1], bed[2]);
  for (let i = 0; i < coarse.visible.length; i += 1) {
    if (coarse.visible[i] !== 1 || !(distance(coarse.rgb, i, bed) > contrast)) continue;
    const l = luma(coarse.rgb[i * 3] ?? 0, coarse.rgb[i * 3 + 1] ?? 0, coarse.rgb[i * 3 + 2] ?? 0);
    (l >= bedLuma ? bright : dark).push(i);
  }
  return dark.length > DARK_SIDE_MAJORITY * bright.length ? dark : bright;
}

// Each pixel's place on the line from the bed's colour to the pieces', clamped to [0, 1].
function alongBedToPiece(
  rgb: Float32Array,
  visible: Uint8Array,
  bed: Colour,
  piece: Colour,
): Float32Array {
  const axis = [piece[0] - bed[0], piece[1] - bed[1], piece[2] - bed[2]];
  const lengthSquared = (axis[0] ?? 0) ** 2 + (axis[1] ?? 0) ** 2 + (axis[2] ?? 0) ** 2;
  const out = new Float32Array(visible.length);
  if (!(lengthSquared > 0)) return out;
  for (let i = 0; i < out.length; i += 1) {
    if (visible[i] !== 1) continue;
    let dot = 0;
    for (let c = 0; c < 3; c += 1) dot += ((rgb[i * 3 + c] ?? 0) - (bed[c] ?? 0)) * (axis[c] ?? 0);
    out[i] = Math.min(1, Math.max(0, dot / lengthSquared));
  }
  return out;
}

// Pixels whose blurred colour is close to the pieces': a piece's inside.
function nearColour(coarse: PieceImage, piece: Colour, bed: Colour): number[] {
  const limit = colourDistance(piece, bed) / 4;
  const out: number[] = [];
  for (let i = 0; i < coarse.visible.length; i += 1) {
    if (coarse.visible[i] === 1 && distance(coarse.rgb, i, piece) < limit) out.push(i);
  }
  return out;
}

/** The least blur under which the bed's texture stays clear of the split, and that split. */
function leastBlur(
  along: Float32Array,
  coarse: PieceImage,
  levels: { readonly bed: ReadonlyArray<number>; readonly piece: ReadonlyArray<number> },
  pixelsPerMm: number,
): { readonly feature: Float32Array; readonly threshold: number } {
  let tried = 0;
  let last: { feature: Float32Array; threshold: number } | null = null;
  for (const radiusMm of BLUR_RADII_MM) {
    const radius = Math.max(1, Math.round(radiusMm * pixelsPerMm));
    if (radius === tried) continue;
    tried = radius;
    const feature = blurVisible(along, coarse.visible, coarse.width, coarse.height, radius);
    const bedLevel = quantile(
      levels.bed.map((i) => feature[i] ?? 0),
      0.5,
    );
    const pieceLevel =
      levels.piece.length === 0
        ? 1
        : quantile(
            levels.piece.map((i) => feature[i] ?? 0),
            0.5,
          );
    const threshold = (bedLevel + pieceLevel) / 2;
    last = { feature, threshold };
    const texture = quantile(
      levels.bed.map((i) => feature[i] ?? 0),
      TEXTURE_QUANTILE,
    );
    if (texture < threshold - TEXTURE_MARGIN * (pieceLevel - bedLevel)) return last;
  }
  return last ?? { feature: new Float32Array(along.length), threshold: 0.5 };
}

/** Mean blurred colour around `at`, or null where the camera saw none of it. */
function meanColour(image: PieceImage, at: PixelPoint): Colour | null {
  const pixels = seenAround(image, at);
  if (pixels.length === 0) return null;
  const sum = [0, 0, 0];
  for (const i of pixels) {
    for (let c = 0; c < 3; c += 1) sum[c] = (sum[c] ?? 0) + (image.rgb[i * 3 + c] ?? 0);
  }
  const n = pixels.length;
  return [(sum[0] ?? 0) / n, (sum[1] ?? 0) / n, (sum[2] ?? 0) / n];
}

// The seen pixels within REFERENCE_RADIUS_PX of `at` (a square window).
function seenAround(image: PieceImage, at: PixelPoint): number[] {
  const pixels: number[] = [];
  const cx = Math.round(at.x);
  const cy = Math.round(at.y);
  for (let y = cy - REFERENCE_RADIUS_PX; y <= cy + REFERENCE_RADIUS_PX; y += 1) {
    for (let x = cx - REFERENCE_RADIUS_PX; x <= cx + REFERENCE_RADIUS_PX; x += 1) {
      if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue;
      if (image.visible[y * image.width + x] === 1) pixels.push(y * image.width + x);
    }
  }
  return pixels;
}

function distance(rgb: Float32Array, i: number, colour: Colour): number {
  return Math.hypot(
    (rgb[i * 3] ?? 0) - colour[0],
    (rgb[i * 3 + 1] ?? 0) - colour[1],
    (rgb[i * 3 + 2] ?? 0) - colour[2],
  );
}

export function colourDistance(a: Colour, b: Colour): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

// Medians and quantiles are read from at most this many evenly spread values.
const MAX_STATISTIC_SAMPLES = 20_000;

/** At most MAX_STATISTIC_SAMPLES of `items`, evenly spread. */
export function spread<T>(items: ReadonlyArray<T>): ReadonlyArray<T> {
  if (items.length <= MAX_STATISTIC_SAMPLES) return items;
  const step = items.length / MAX_STATISTIC_SAMPLES;
  const out: T[] = [];
  for (let k = 0; k < MAX_STATISTIC_SAMPLES; k += 1) {
    const item = items[Math.floor(k * step)];
    if (item !== undefined) out.push(item);
  }
  return out;
}

/** The `q` quantile of `values` (0..1), by nearest rank; 0 when empty. */
export function quantile(values: ReadonlyArray<number>, q: number): number {
  if (values.length === 0) return 0;
  const sorted = Float64Array.from(spread(values)).sort();
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[rank] ?? 0;
}
