// The separate pieces in a piece mask (ADR-442): the mask is opened to drop
// specks and closed to bridge hairline gaps, then each 4-connected group of
// piece pixels becomes one component with its pixel count, centroid, outer
// outline and whether it runs into a part of the bed the camera did not see
// (a piece cut off by the picture's edge or the camera's view). The centroid
// counts only piece pixels, so a hole or a cut-out shifts it. Pure core.

import { contractMask, expandMask, maskOutline, type SelectionMask } from '../../image-select';
import type { PieceMask, PixelPoint } from './piece-mask';

export type PieceComponent = {
  /** Piece pixels. */
  readonly pixels: number;
  /** Mean of the piece pixels' centres, pixel units. */
  readonly centroid: PixelPoint;
  /** Outer boundary, pixel-corner units, closed without repeating the first point. */
  readonly outline: ReadonlyArray<PixelPoint>;
  /**
   * Where each boundary crossing between a piece pixel and its neighbour
   * really lies, found between the two pixel centres; pixel-corner units.
   * Unlike the stepped outline these sit on the edge itself.
   */
  readonly edgePoints: ReadonlyArray<PixelPoint>;
  /** True when the piece touches the picture's edge or a pixel the camera did not see. */
  readonly partial: boolean;
};

// A selected pixel in the image-select masks.
const MASK_SOLID = 255;

type Box = { x0: number; y0: number; x1: number; y1: number };

type Tally = {
  pixels: number;
  sumX: number;
  sumY: number;
  box: Box;
  partial: boolean;
  edgePoints: PixelPoint[];
};

/**
 * Components of at least `minPixels`, in scan order. `cleanRadiusPx` sizes
 * the opening and closing; 0 leaves the mask as it is.
 */
export function pieceComponents(
  mask: PieceMask,
  visible: Uint8Array,
  cleanRadiusPx: number,
  minPixels: number,
): PieceComponent[] {
  const clean = cleaned(mask, visible, cleanRadiusPx);
  const labels = new Int32Array(mask.width * mask.height);
  const components: PieceComponent[] = [];
  let label = 0;
  for (let start = 0; start < labels.length; start += 1) {
    if (clean[start] !== 1 || labels[start] !== 0) continue;
    label += 1;
    const tally = flood(mask, clean, visible, labels, start, label);
    if (tally.pixels < minPixels) continue;
    components.push({
      pixels: tally.pixels,
      centroid: { x: tally.sumX / tally.pixels + 0.5, y: tally.sumY / tally.pixels + 0.5 },
      outline: outerOutline(labels, mask.width, tally.box, label),
      edgePoints: tally.edgePoints,
      partial: tally.partial,
    });
  }
  return components;
}

// Open (shrink then grow) removes specks narrower than the radius; close
// (grow then shrink) fills gaps narrower than it. Unseen pixels stay off.
function cleaned(mask: PieceMask, visible: Uint8Array, radius: number): Uint8Array {
  const r = Math.max(0, Math.round(radius));
  const alpha = new Uint8Array(mask.on.length);
  for (let i = 0; i < alpha.length; i += 1) alpha[i] = mask.on[i] === 1 ? MASK_SOLID : 0;
  let selection: SelectionMask = { width: mask.width, height: mask.height, alpha };
  if (r > 0) {
    selection = expandMask(contractMask(selection, r), r);
    selection = contractMask(expandMask(selection, r), r);
  }
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
    count(tally, x, y);
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
// threshold, linearly; half way when it does not cross between them.
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

function count(tally: Tally, x: number, y: number): void {
  tally.pixels += 1;
  tally.sumX += x;
  tally.sumY += y;
  tally.box.x0 = Math.min(tally.box.x0, x);
  tally.box.y0 = Math.min(tally.box.y0, y);
  tally.box.x1 = Math.max(tally.box.x1, x);
  tally.box.y1 = Math.max(tally.box.y1, y);
}

// The component alone, cropped to its box, traced; the loop enclosing the
// most area is the outer one (the rest are holes).
function outerOutline(
  labels: Int32Array,
  width: number,
  box: Box,
  label: number,
): ReadonlyArray<PixelPoint> {
  const cropWidth = box.x1 - box.x0 + 1;
  const cropHeight = box.y1 - box.y0 + 1;
  const alpha = new Uint8Array(cropWidth * cropHeight);
  for (let y = 0; y < cropHeight; y += 1) {
    for (let x = 0; x < cropWidth; x += 1) {
      if (labels[(y + box.y0) * width + x + box.x0] === label)
        alpha[y * cropWidth + x] = MASK_SOLID;
    }
  }
  let best: ReadonlyArray<PixelPoint> = [];
  let bestArea = -1;
  for (const loop of maskOutline({ width: cropWidth, height: cropHeight, alpha })) {
    const area = Math.abs(loopArea(loop));
    if (area > bestArea) {
      bestArea = area;
      best = loop;
    }
  }
  return best.map((p) => ({ x: p.x + box.x0, y: p.y + box.y0 }));
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
