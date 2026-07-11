// Ink-boundary extraction for the contour (filled-outline) tracer.
//
// Walks the ink/paper interface of a binary mask on the pixel-CORNER lattice
// (pixel (px,py) occupies the unit square [px,px+1]×[py,py+1]), producing one
// closed loop per boundary: outer boundaries and hole boundaries come out as
// separate loops with opposite orientation, so even-odd filling downstream
// keeps holes hollow. Written from scratch against our own mask/Vec2 types —
// boundary following on a lattice is textbook material (Pavlidis 1982).

import type { Vec2 } from '../scene';
import type { InkMask } from './centerline';

export type BoundaryLoop = {
  /** Closed staircase of lattice-corner points; last point ≠ first. */
  readonly points: ReadonlyArray<Vec2>;
  /** Signed shoelace area in px²; sign encodes orientation (holes oppose). */
  readonly area: number;
};

// Directions are indexed E,S,W,N; each boundary edge travels with ink on its
// RIGHT in screen coordinates (y down), so outer loops run counter-clockwise
// on screen and hole loops clockwise.
const DIR_X = [1, 0, -1, 0] as const;
const DIR_Y = [0, 1, 0, -1] as const;

/** Extract every closed ink-boundary loop of the mask. */
export function traceBoundaryLoops(mask: InkMask): BoundaryLoop[] {
  const edges = collectBoundaryEdges(mask);
  const loops: BoundaryLoop[] = [];
  for (const [start, dirs] of edges) {
    while (dirs.size > 0) {
      const firstDir = dirs.values().next().value;
      if (firstDir === undefined) break;
      loops.push(walkLoop(mask, edges, start, firstDir));
    }
  }
  return loops;
}

/** Pre-threshold grayscale access for sub-pixel crack interpolation. Luma is
 *  in the SAME (gamma-encoded) space the threshold cut is defined in — the
 *  iso-line must match the space of the cut, so no linearization here. The
 *  threshold is a per-position function because the sketch (local-contrast)
 *  binarization cuts at luma = localMean − bias, not at a global constant. */
export type CrackSubPixelField = {
  /** Luma at pixel (x,y); out-of-bounds must read as background (255). */
  readonly lumaAt: (x: number, y: number) => number;
  /** Ink is luma ≤ thresholdAt(x,y) at that position. */
  readonly thresholdAt: (x: number, y: number) => number;
};

// Interpolation clamp: near-flat luma pairs put the crossing arbitrarily
// close to a pixel centre; clamping keeps one vertex from touching the next
// crack's territory when the ramp is noisy.
const SUBPIXEL_T_MIN = 0.1;
const SUBPIXEL_T_MAX = 0.9;
const MID_CRACK_T = 0.5;
// A saturated luma step (paper-white against full ink) contains NO sub-pixel
// information — the true edge could be anywhere inside the step. Only pairs
// with a genuine anti-aliasing ramp may move the vertex; without this gate a
// position-dependent threshold (sketch mode) turns hard binary edges into
// position noise (measured: jittered-ring roundness 0.25 → 0.33px RMS).
const SATURATED_BG_LUMA = 250;
const SATURATED_INK_LUMA = 5;

/** Midpoints of consecutive staircase edges — the dense "mid-crack" chain the
 *  curve-finishing stages consume. Halves the staircase amplitude and turns
 *  lattice corners into ≤45° bends, so curvature smoothing is not fooled
 *  into pinning every vertex as a hard turn.
 *
 *  With a CrackSubPixelField, each vertex moves from the crack midpoint to
 *  the true threshold iso-crossing between the two pixel centres the crack
 *  separates (marching squares with linear interpolation; the plain midpoint
 *  is the degenerate t = 0.5 case). The anti-aliasing ramp encodes the
 *  sub-pixel edge position that binarization quantizes away — interpolating
 *  it removes the ~1px boundary meander at the source instead of asking the
 *  smoothing stages to fight it (research brief 2026-07-10). */
export function midCrackChain(loop: ReadonlyArray<Vec2>, field?: CrackSubPixelField): Vec2[] {
  return midCrackChainWithStats(loop, field).points;
}

export type MidCrackChain = {
  readonly points: Vec2[];
  /** Fraction of cracks whose crossing carried real sub-pixel information
   *  (|t − 0.5| beyond noise). ~0 on binary sources (saturated steps stay at
   *  the midpoint), high on anti-aliased art — the signal callers use to
   *  decide whether quantization-noise smoothing is still needed. */
  readonly interpolatedFraction: number;
};

// |t − 0.5| below this is indistinguishable from the plain midpoint.
const INTERPOLATED_T_EPS = 0.05;

export function midCrackChainWithStats(
  loop: ReadonlyArray<Vec2>,
  field?: CrackSubPixelField,
): MidCrackChain {
  const n = loop.length;
  const out: Vec2[] = [];
  let interpolated = 0;
  for (let i = 0; i < n; i += 1) {
    const a = loop[i] as Vec2;
    const b = loop[(i + 1) % n] as Vec2;
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    if (field === undefined) {
      out.push({ x: midX, y: midY });
      continue;
    }
    // Ink lies on the RIGHT of travel (see walker header): right of (dx,dy)
    // in screen coords is (-dy, dx). The crack midpoint sits exactly halfway
    // between the background pixel centre (t=0) and ink pixel centre (t=1).
    const rightX = -(b.y - a.y);
    const rightY = b.x - a.x;
    const t = crackCrossing(field, midX, midY, rightX, rightY);
    if (Math.abs(t - MID_CRACK_T) > INTERPOLATED_T_EPS) interpolated += 1;
    out.push({ x: midX + (t - MID_CRACK_T) * rightX, y: midY + (t - MID_CRACK_T) * rightY });
  }
  return { points: out, interpolatedFraction: n === 0 ? 0 : interpolated / n };
}

function crackCrossing(
  field: CrackSubPixelField,
  midX: number,
  midY: number,
  rightX: number,
  rightY: number,
): number {
  const inkX = Math.floor(midX + MID_CRACK_T * rightX);
  const inkY = Math.floor(midY + MID_CRACK_T * rightY);
  const bgX = Math.floor(midX - MID_CRACK_T * rightX);
  const bgY = Math.floor(midY - MID_CRACK_T * rightY);
  const inkLuma = field.lumaAt(inkX, inkY);
  const bgLuma = field.lumaAt(bgX, bgY);
  if (bgLuma >= SATURATED_BG_LUMA && inkLuma <= SATURATED_INK_LUMA) return MID_CRACK_T;
  // The iso value across the crack: mean of the two positions' thresholds
  // (they differ only in sketch mode, where the cut tracks the local mean).
  const threshold = (field.thresholdAt(inkX, inkY) + field.thresholdAt(bgX, bgY)) / 2;
  // Only a proper straddle interpolates. Cleanup stages (despeckle, pinhole
  // fill) flip mask pixels without touching the luma, so cracks they create
  // have no crossing — those stay at the plain midpoint.
  if (!(bgLuma > threshold && inkLuma <= threshold)) return MID_CRACK_T;
  const t = (bgLuma - threshold) / (bgLuma - inkLuma);
  return Math.min(SUBPIXEL_T_MAX, Math.max(SUBPIXEL_T_MIN, t));
}

type EdgeMap = Map<number, Set<number>>;

function collectBoundaryEdges(mask: InkMask): EdgeMap {
  const { width, height } = mask;
  const edges: EdgeMap = new Map();
  const stride = width + 1;
  const add = (x: number, y: number, dir: number): void => {
    const key = y * stride + x;
    const set = edges.get(key);
    if (set === undefined) edges.set(key, new Set([dir]));
    else set.add(dir);
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (inkAt(mask, x, y) === 0) continue;
      // One directed lattice edge per exposed pixel side, ink on the right.
      if (inkAt(mask, x, y - 1) === 0) add(x, y, 0); // top side, travel E
      if (inkAt(mask, x + 1, y) === 0) add(x + 1, y, 1); // right side, travel S
      if (inkAt(mask, x, y + 1) === 0) add(x + 1, y + 1, 2); // bottom, travel W
      if (inkAt(mask, x - 1, y) === 0) add(x, y + 1, 3); // left side, travel N
    }
  }
  return edges;
}

function walkLoop(mask: InkMask, edges: EdgeMap, startKey: number, startDir: number): BoundaryLoop {
  const stride = mask.width + 1;
  const points: Vec2[] = [];
  let area = 0;
  let key = startKey;
  let dir = startDir;
  do {
    consumeEdge(edges, key, dir);
    const x = key % stride;
    const y = (key - x) / stride;
    const nx = x + (DIR_X[dir] as number);
    const ny = y + (DIR_Y[dir] as number);
    points.push({ x, y });
    // Shoelace accumulates over the directed edge (x,y)→(nx,ny).
    area += x * ny - nx * y;
    key = ny * stride + nx;
    dir = nextDirection(edges, key, dir);
  } while (!(key === startKey && dir === startDir) && dir !== -1);
  return { points, area: area / 2 };
}

// At almost every corner exactly one out-edge remains. Two remain only at a
// "saddle" (two diagonally-touching ink pixels): prefer the RIGHT turn, which
// hugs the ink we are already tracing and keeps diagonal blobs as separate
// loops instead of welding them through the corner.
function nextDirection(edges: EdgeMap, key: number, incomingDir: number): number {
  const set = edges.get(key);
  if (set === undefined || set.size === 0) return -1;
  const right = (incomingDir + 1) % 4;
  if (set.has(right)) return right;
  if (set.has(incomingDir)) return incomingDir;
  const left = (incomingDir + 3) % 4;
  if (set.has(left)) return left;
  return -1;
}

function consumeEdge(edges: EdgeMap, key: number, dir: number): void {
  const set = edges.get(key);
  if (set === undefined) return;
  set.delete(dir);
  if (set.size === 0) edges.delete(key);
}

function inkAt(mask: InkMask, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return 0;
  return mask.ink[y * mask.width + x] ?? 0;
}
