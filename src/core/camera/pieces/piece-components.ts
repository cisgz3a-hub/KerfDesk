// The separate pieces in a piece mask (ADR-442): the mask is opened to drop
// specks and closed to bridge hairline gaps, what it leaves out inside a piece
// that is not the bed showing through is filled (piece-holes.ts), pieces
// meeting at a narrow neck are cut apart (piece-split.ts), then each 4-connected group of piece pixels
// becomes one component with its pixel count, centroid, mean colour, outer
// outline and holes, the point of it furthest from the bed, and whether it
// runs into a part of the bed the camera did not see (a piece cut off by the
// picture's edge or the camera's view). The centroid counts only piece
// pixels, so a hole or a cut-out shifts it. Pure core.

import { contractMask, expandMask, maskOutline, type SelectionMask } from '../../image-select';
import type { Colour, PieceMask, PixelPoint } from './piece-mask';
import { fillMaterialHoles } from './piece-holes';
import { cutAtNecks, distanceToBed } from './piece-split';

export type PieceComponent = {
  /** Piece pixels. */
  readonly pixels: number;
  /** Mean of the piece pixels' centres, pixel units. */
  readonly centroid: PixelPoint;
  /** Mean unblurred colour of the piece pixels. */
  readonly colour: Colour;
  /** Outer boundary, pixel-corner units, closed without repeating the first point. */
  readonly outline: ReadonlyArray<PixelPoint>;
  /** Boundaries of the holes in it, pixel-corner units. */
  readonly holes: ReadonlyArray<ReadonlyArray<PixelPoint>>;
  /**
   * Where each boundary crossing between a piece pixel and its neighbour
   * really lies, found between the two pixel centres; pixel-corner units.
   * Unlike the stepped outline these sit on the edge itself.
   */
  readonly edgePoints: ReadonlyArray<PixelPoint>;
  /** True when the piece touches the picture's edge or a pixel the camera did not see. */
  readonly partial: boolean;
  /** How far the deepest point of the piece lies from the bed, px. */
  readonly depthPx: number;
  /** Pixel centres (pixel-corner units) that lie within a pixel of that depth. */
  readonly deepest: ReadonlyArray<PixelPoint>;
  /** How far the point lies from the bed, px; 0 off this piece. */
  readonly depthAt: (point: PixelPoint) => number;
};

export type CleanRadii = { readonly openPx: number; readonly closePx: number };

// A selected pixel in the image-select masks.
const MASK_SOLID = 255;
// Holes smaller than this many pixels are noise, not cut-outs.
const MIN_HOLE_PIXELS = 8;
// A meeting point whose feature lies below this share of the way from the
// split up to the pieces' level is on a seam between two pieces.
const SEAM_SHARE = 0.5;
// Where two flooded regions first meet can lie this far from the seam itself,
// mm; a waist is solid wood further than this either side of its middle.
const SEAM_REACH_MM = 2.5;
// The deepest points are those within this many pixels of the deepest.
const DEEPEST_TOLERANCE_PX = 1;

type Box = { x0: number; y0: number; x1: number; y1: number };

type Tally = {
  pixels: number;
  sumX: number;
  sumY: number;
  colour: [number, number, number];
  box: Box;
  partial: boolean;
  edgePoints: PixelPoint[];
};

/**
 * Components of at least `minPixels`, in scan order. `radii` size the
 * opening and closing; 0 leaves the mask as it is.
 */
export function pieceComponents(
  mask: PieceMask,
  visible: Uint8Array,
  radii: CleanRadii,
  minPixels: number,
  pixelsPerMm: number,
): PieceComponent[] {
  const clean = cleaned(mask, visible, radii);
  // Filled knots are wood: their dark colour is no seam.
  const filled = fillMaterialHoles(
    clean,
    visible,
    mask.width,
    mask.rgb,
    mask.bedColour,
    mask.bedContrast,
  );
  // A seam: the pieces' colour dips at least halfway from their level to the
  // split, where two blanks lie a hairline apart and the close bridged them.
  const seamLevel = mask.threshold + SEAM_SHARE * (mask.pieceLevel - mask.threshold);
  cutAtNecks(
    clean,
    distanceToBed(clean, visible, mask.width, mask.height),
    mask.width,
    pixelsPerMm,
    (pixel) => dipsNear(mask, filled, pixel, seamLevel, Math.round(SEAM_REACH_MM * pixelsPerMm)),
  );
  const depth = distanceToBed(clean, visible, mask.width, mask.height);
  const labels = new Int32Array(mask.width * mask.height);
  const components: PieceComponent[] = [];
  let label = 0;
  for (let start = 0; start < labels.length; start += 1) {
    if (clean[start] !== 1 || labels[start] !== 0) continue;
    label += 1;
    const tally = flood(mask, clean, visible, labels, start, label);
    if (tally.pixels < minPixels) continue;
    const loops = loopsOf(labels, mask.width, tally.box, label);
    components.push({
      pixels: tally.pixels,
      centroid: { x: tally.sumX / tally.pixels + 0.5, y: tally.sumY / tally.pixels + 0.5 },
      colour: [
        tally.colour[0] / tally.pixels,
        tally.colour[1] / tally.pixels,
        tally.colour[2] / tally.pixels,
      ],
      outline: loops[0] ?? [],
      holes: loops.slice(1),
      edgePoints: tally.edgePoints,
      partial: tally.partial,
      ...deepestPoints(depth, labels, mask.width, tally.box, label),
    });
  }
  return components;
}

// True when the feature within `reach` pixels of `pixel` falls below `level`:
// the meeting point lies on, or beside, a seam.
function dipsNear(
  mask: PieceMask,
  filled: Uint8Array,
  pixel: number,
  level: number,
  reach: number,
): boolean {
  const x0 = pixel % mask.width;
  const y0 = (pixel - x0) / mask.width;
  for (let y = Math.max(0, y0 - reach); y <= Math.min(mask.height - 1, y0 + reach); y += 1) {
    for (let x = Math.max(0, x0 - reach); x <= Math.min(mask.width - 1, x0 + reach); x += 1) {
      const i = y * mask.width + x;
      if (filled[i] !== 1 && (mask.feature[i] ?? 0) < level) return true;
    }
  }
  return false;
}

// Open (shrink then grow) removes specks narrower than its radius; close
// (grow then shrink) fills gaps narrower than its. Unseen pixels stay off.
function cleaned(mask: PieceMask, visible: Uint8Array, radii: CleanRadii): Uint8Array {
  const open = Math.max(0, Math.round(radii.openPx));
  const close = Math.max(0, Math.round(radii.closePx));
  const alpha = new Uint8Array(mask.on.length);
  for (let i = 0; i < alpha.length; i += 1) alpha[i] = mask.on[i] === 1 ? MASK_SOLID : 0;
  let selection: SelectionMask = { width: mask.width, height: mask.height, alpha };
  if (open > 0) selection = expandMask(contractMask(selection, open), open);
  if (close > 0) selection = contractMask(expandMask(selection, close), close);
  const out = new Uint8Array(alpha.length);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = visible[i] === 1 && (selection.alpha[i] ?? 0) === MASK_SOLID ? 1 : 0;
  }
  return out;
}

function flood(
  mask: PieceMask,
  on: Uint8Array,
  visible: Uint8Array,
  labels: Int32Array,
  start: number,
  label: number,
): Tally {
  const { width, height } = mask;
  const tally: Tally = {
    pixels: 0,
    sumX: 0,
    sumY: 0,
    colour: [0, 0, 0],
    box: { x0: width, y0: height, x1: -1, y1: -1 },
    partial: false,
    edgePoints: [],
  };
  const queue = [start];
  labels[start] = label;
  // The queue grows while it is walked; an array iterator follows it.
  for (const i of queue) {
    const x = i % width;
    const y = (i - x) / width;
    count(tally, mask.rgb, i, x, y);
    const neighbours: ReadonlyArray<readonly [number, number]> = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ];
    for (const [nx, ny] of neighbours) {
      const j = ny * width + nx;
      const outside = nx < 0 || ny < 0 || nx >= width || ny >= height;
      if (outside || visible[j] !== 1) {
        tally.partial = true;
        tally.edgePoints.push(crossing(x, y, nx, ny, 0.5));
        continue;
      }
      if (on[j] !== 1) {
        tally.edgePoints.push(crossing(x, y, nx, ny, edgeFraction(mask, i, j)));
        continue;
      }
      if (labels[j] !== 0) continue;
      labels[j] = label;
      queue.push(j);
    }
  }
  return tally;
}

// How far from pixel i's centre toward pixel j's the feature crosses the
// threshold, linearly; half way when it does not cross between them (a cut
// between two pieces, or a cleaned speck).
function edgeFraction(mask: PieceMask, i: number, j: number): number {
  const a = mask.feature[i] ?? 0;
  const b = mask.feature[j] ?? 0;
  if (a === b) return 0.5;
  const t = (mask.threshold - a) / (b - a);
  return t >= 0 && t <= 1 ? t : 0.5;
}

// The point `t` of the way from pixel (x, y)'s centre to (nx, ny)'s, in
// pixel-corner units.
function crossing(x: number, y: number, nx: number, ny: number, t: number): PixelPoint {
  return { x: x + 0.5 + (nx - x) * t, y: y + 0.5 + (ny - y) * t };
}

function count(tally: Tally, rgb: Float32Array, i: number, x: number, y: number): void {
  tally.pixels += 1;
  tally.sumX += x;
  tally.sumY += y;
  tally.colour[0] += rgb[i * 3] ?? 0;
  tally.colour[1] += rgb[i * 3 + 1] ?? 0;
  tally.colour[2] += rgb[i * 3 + 2] ?? 0;
  tally.box.x0 = Math.min(tally.box.x0, x);
  tally.box.y0 = Math.min(tally.box.y0, y);
  tally.box.x1 = Math.max(tally.box.x1, x);
  tally.box.y1 = Math.max(tally.box.y1, y);
}

// The deepest points of one component, and its depth at any point.
function deepestPoints(
  depth: Float32Array,
  labels: Int32Array,
  width: number,
  box: Box,
  label: number,
): Pick<PieceComponent, 'depthPx' | 'deepest' | 'depthAt'> {
  let depthPx = 0;
  for (let y = box.y0; y <= box.y1; y += 1) {
    for (let x = box.x0; x <= box.x1; x += 1) {
      const i = y * width + x;
      if (labels[i] === label) depthPx = Math.max(depthPx, depth[i] ?? 0);
    }
  }
  const deepest: PixelPoint[] = [];
  for (let y = box.y0; y <= box.y1; y += 1) {
    for (let x = box.x0; x <= box.x1; x += 1) {
      const i = y * width + x;
      if (labels[i] === label && (depth[i] ?? 0) >= depthPx - DEEPEST_TOLERANCE_PX) {
        deepest.push({ x: x + 0.5, y: y + 0.5 });
      }
    }
  }
  const depthAt = (point: PixelPoint): number => {
    const x = Math.floor(point.x);
    const y = Math.floor(point.y);
    if (x < box.x0 || y < box.y0 || x > box.x1 || y > box.y1) return 0;
    const i = y * width + x;
    return labels[i] === label ? (depth[i] ?? 0) : 0;
  };
  return { depthPx, deepest, depthAt };
}

// The component alone, cropped to its box, traced: the loop enclosing the
// most area first (the outer one), then the holes big enough to matter.
function loopsOf(
  labels: Int32Array,
  width: number,
  box: Box,
  label: number,
): ReadonlyArray<ReadonlyArray<PixelPoint>> {
  const cropWidth = box.x1 - box.x0 + 1;
  const cropHeight = box.y1 - box.y0 + 1;
  const alpha = new Uint8Array(cropWidth * cropHeight);
  for (let y = 0; y < cropHeight; y += 1) {
    for (let x = 0; x < cropWidth; x += 1) {
      if (labels[(y + box.y0) * width + x + box.x0] === label)
        alpha[y * cropWidth + x] = MASK_SOLID;
    }
  }
  const loops = maskOutline({ width: cropWidth, height: cropHeight, alpha })
    .map((loop) => ({ loop, area: Math.abs(loopArea(loop)) }))
    .sort((a, b) => b.area - a.area);
  return loops
    .filter((entry, index) => index === 0 || entry.area >= MIN_HOLE_PIXELS)
    .map((entry) => entry.loop.map((p) => ({ x: p.x + box.x0, y: p.y + box.y0 })));
}

function loopArea(loop: ReadonlyArray<PixelPoint>): number {
  let twice = 0;
  for (let i = 0; i < loop.length; i += 1) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    if (a === undefined || b === undefined) continue;
    twice += a.x * b.y - b.x * a.y;
  }
  return twice / 2;
}
