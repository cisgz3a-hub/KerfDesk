// Sub-pixel placement of the colour-layer boundary chains (ADR-402). Own
// design. Each crack of a chain sits between two pixels of different colours;
// reading those pixels' source colours as coverage mixtures of the two region
// colours moves the crack's midpoint to where the edge really lies. Chain
// ends meet at junctions whose position every meeting chain shares.
//
// Pure core: deterministic, no clock, no random, no I/O.

import type { Vec2 } from '../scene';
import type { BoundaryChain } from './colour-regions';
import { TRANSPARENT_LABEL, type QuantizedColours } from './colour-quantize';

// Sub-pixel edge placement trusts a pixel only when its colour lies near the
// segment between the two region colours, and the two colours differ.
const SUBPIXEL_RESIDUAL_FRACTION = 0.5;
const SUBPIXEL_MIN_CONTRAST = 12; // sRGB byte distance
// Offsets are median-filtered over same-direction cracks within this reach.
const OFFSET_MEDIAN_REACH = 2;
// Cracks per chain end whose measured points place a junction, the weight
// tying a junction to its lattice vertex (per meeting line), and the most a
// junction may move from that vertex.
const JUNCTION_REACH = 6;
const JUNCTION_LATTICE_TIE = 0.02;
const JUNCTION_MAX_SHIFT_PX = 1;

function crackDirection(dir: number): Vec2 {
  if (dir === 0) return { x: 1, y: 0 };
  if (dir === 1) return { x: 0, y: 1 };
  if (dir === 2) return { x: -1, y: 0 };
  return { x: 0, y: -1 };
}

/** Unit normal from the crack's left pixel to its right pixel. */
export function crackNormal(dir: number): Vec2 {
  const d = crackDirection(dir);
  return { x: -d.y, y: d.x };
}

export function vertexAt(chain: BoundaryChain, index: number): Vec2 {
  const n = chain.xs.length;
  const i = chain.closed ? ((index % n) + n) % n : index;
  return { x: chain.xs[i] as number, y: chain.ys[i] as number };
}

export function crackPoint(chain: BoundaryChain, i: number, offset: number): Vec2 {
  const a = vertexAt(chain, i);
  const b = vertexAt(chain, i + 1);
  const normal = crackNormal(chain.dirs[i] as number);
  return {
    x: (a.x + b.x) / 2 + offset * normal.x,
    y: (a.y + b.y) / 2 + offset * normal.y,
  };
}

/** The corner vertex between crack k-1 and crack k, moved by both cracks'
 *  sub-pixel offsets (their normals are perpendicular at a lattice corner, so
 *  this is where the two shifted edges meet). */
export function cornerPoint(chain: BoundaryChain, k: number, offsets: Float64Array): Vec2 {
  const cracks = chain.dirs.length;
  const before = (k - 1 + cracks) % cracks;
  const v = vertexAt(chain, k);
  const n1 = crackNormal(chain.dirs[before] as number);
  const n2 = crackNormal(chain.dirs[k] as number);
  const o1 = offsets[before] as number;
  const o2 = offsets[k] as number;
  return { x: v.x + o1 * n1.x + o2 * n2.x, y: v.y + o1 * n1.y + o2 * n2.y };
}

/** Every crack offset of a chain: measured, then median-filtered along the
 *  chain over same-direction cracks (±2). A crack whose pixels hold a third
 *  colour (junctions) or two edges (corners) is unmeasured or biased; its
 *  run neighbours measure the same straight edge. */
export function chainOffsets(chain: BoundaryChain, q: QuantizedColours): Float64Array {
  const cracks = chain.dirs.length;
  const raw = new Float64Array(cracks);
  for (let i = 0; i < cracks; i += 1) raw[i] = crackOffset(chain, i, q);
  const out = new Float64Array(cracks);
  const window: number[] = [];
  for (let i = 0; i < cracks; i += 1) {
    window.length = 0;
    const dir = chain.dirs[i];
    for (let d = -OFFSET_MEDIAN_REACH; d <= OFFSET_MEDIAN_REACH; d += 1) {
      const j = neighbourCrack(chain, i, d);
      const v = j < 0 ? Number.NaN : (raw[j] as number);
      if (chain.dirs[j] === dir && Number.isFinite(v)) window.push(v);
    }
    out[i] = window.length === 0 ? 0 : median(window);
  }
  return out;
}

// Crack i + d along the chain, or -1 past an open chain's ends (or half way
// round a short closed one, which would read the far side).
function neighbourCrack(chain: BoundaryChain, i: number, d: number): number {
  const cracks = chain.dirs.length;
  if (!chain.closed) return i + d >= 0 && i + d < cracks ? i + d : -1;
  return Math.abs(d) * 2 >= cracks ? -1 : (i + d + cracks) % cracks;
}

function median(values: number[]): number {
  values.sort((a, b) => a - b);
  const mid = values.length >> 1;
  return values.length % 2 === 1
    ? (values[mid] as number)
    : ((values[mid - 1] as number) + (values[mid] as number)) / 2;
}

type MixLine = {
  readonly ca: readonly [number, number, number];
  readonly d0: number;
  readonly d1: number;
  readonly d2: number;
  readonly len2: number;
};

/** Signed shift of crack i's midpoint along its left→right normal, from the
 *  two pixels' colours read as coverage mixtures of the two region colours:
 *  with the edge at e (0 = left pixel centre, 1 = right pixel centre) the
 *  right colour covers 0.5 - e of the left pixel or 1.5 - e of the right one,
 *  so e = 1.5 - t_left - t_right. Coverage is read in sRGB bytes, where
 *  rasterisers blend anti-aliased edges. A pixel that is 1 px thin across the
 *  crack carries two edges and is read as solid; a pixel off the two-colour
 *  mixing line (a third colour nearby) leaves the crack unmeasured (NaN). */
function crackOffset(chain: BoundaryChain, i: number, q: QuantizedColours): number {
  const lp = chain.leftPixels[i] as number;
  const rp = chain.rightPixels[i] as number;
  if (lp < 0 || rp < 0) return 0;
  const line = mixLine(q, q.labels[lp] as number, q.labels[rp] as number);
  if (line === null) return 0;
  const normal = crackNormal(chain.dirs[i] as number);
  const tLeft = thinAcross(q, lp, -normal.x, -normal.y) ? 0 : coverage(q, lp, line);
  const tRight = thinAcross(q, rp, normal.x, normal.y) ? 1 : coverage(q, rp, line);
  const e = Math.max(0, Math.min(1, 1.5 - tLeft - tRight));
  return e - 0.5;
}

// The sRGB mixing line from label a's colour to label b's, or null when the
// crack cannot be measured (transparency, one colour, too little contrast).
function mixLine(q: QuantizedColours, a: number, b: number): MixLine | null {
  if (a === TRANSPARENT_LABEL || b === TRANSPARENT_LABEL || a === b) return null;
  const ca = q.palette[a]?.srgb;
  const cb = q.palette[b]?.srgb;
  if (ca === undefined || cb === undefined) return null;
  const d0 = cb[0] - ca[0];
  const d1 = cb[1] - ca[1];
  const d2 = cb[2] - ca[2];
  const len2 = d0 * d0 + d1 * d1 + d2 * d2;
  return len2 < SUBPIXEL_MIN_CONTRAST * SUBPIXEL_MIN_CONTRAST ? null : { ca, d0, d1, d2, len2 };
}

function coverage(q: QuantizedColours, pixel: number, line: MixLine): number {
  const r = (q.rgba[pixel * 4] as number) - line.ca[0];
  const g = (q.rgba[pixel * 4 + 1] as number) - line.ca[1];
  const b = (q.rgba[pixel * 4 + 2] as number) - line.ca[2];
  const t = (r * line.d0 + g * line.d1 + b * line.d2) / line.len2;
  const r0 = r - t * line.d0;
  const r1 = g - t * line.d1;
  const r2 = b - t * line.d2;
  if (r0 * r0 + r1 * r1 + r2 * r2 > SUBPIXEL_RESIDUAL_FRACTION ** 2 * line.len2) return Number.NaN;
  return Math.max(0, Math.min(1, t));
}

// True when the pixel beyond `pixel` (one step along (nx, ny)) carries another
// label too: the pixel is 1 px thin across this crack.
function thinAcross(q: QuantizedColours, pixel: number, nx: number, ny: number): boolean {
  const x = (pixel % q.width) + nx;
  const y = Math.floor(pixel / q.width) + ny;
  if (x < 0 || y < 0 || x >= q.width || y >= q.height) return false;
  return q.labels[y * q.width + x] !== q.labels[pixel];
}

/** Sub-pixel junction positions keyed by lattice vertex (y * (width+1) + x),
 *  shared by every chain meeting there. Each chain end contributes the
 *  straight line through its measured points a little away from the junction
 *  (the pixels AT a junction mix three colours and measure nothing); the
 *  junction is their least-squares intersection, gently tied to the lattice
 *  vertex so parallel edges stay well posed, and kept within a pixel of it. */
export function junctionPositions(
  chains: ReadonlyArray<BoundaryChain>,
  offsets: ReadonlyArray<Float64Array>,
  width: number,
): Map<number, Vec2> {
  // Per vertex: normal-equation sums [a11, a12, a22, b1, b2, lines].
  const sums = new Map<number, number[]>();
  chains.forEach((chain, index) => {
    if (chain.closed) return;
    const off = offsets[index] as Float64Array;
    const last = chain.xs.length - 1;
    addLine(sums, vertexKey(chain, 0, width), endLine(chain, off, true));
    addLine(sums, vertexKey(chain, last, width), endLine(chain, off, false));
  });
  const positions = new Map<number, Vec2>();
  for (const [key, sum] of sums) {
    const position = solveJunction(sum, key % (width + 1), Math.floor(key / (width + 1)));
    if (position !== null) positions.set(key, position);
  }
  return positions;
}

function vertexKey(chain: BoundaryChain, index: number, width: number): number {
  return (chain.ys[index] as number) * (width + 1) + (chain.xs[index] as number);
}

function addLine(sums: Map<number, number[]>, key: number, line: EdgeLine | null): void {
  if (line === null) return;
  let sum = sums.get(key);
  if (sum === undefined) {
    sum = [0, 0, 0, 0, 0, 0];
    sums.set(key, sum);
  }
  // Projector onto the line's normal: I - d d^T.
  const m11 = 1 - line.dx * line.dx;
  const m12 = -line.dx * line.dy;
  const m22 = 1 - line.dy * line.dy;
  sum[0] = (sum[0] as number) + m11;
  sum[1] = (sum[1] as number) + m12;
  sum[2] = (sum[2] as number) + m22;
  sum[3] = (sum[3] as number) + m11 * line.px + m12 * line.py;
  sum[4] = (sum[4] as number) + m12 * line.px + m22 * line.py;
  sum[5] = (sum[5] as number) + 1;
}

function solveJunction(sum: ReadonlyArray<number>, vx: number, vy: number): Vec2 | null {
  const tie = JUNCTION_LATTICE_TIE * (sum[5] as number);
  const a11 = (sum[0] as number) + tie;
  const a12 = sum[1] as number;
  const a22 = (sum[2] as number) + tie;
  const b1 = (sum[3] as number) + tie * vx;
  const b2 = (sum[4] as number) + tie * vy;
  const det = a11 * a22 - a12 * a12;
  if (Math.abs(det) < 1e-12) return null;
  const x = (b1 * a22 - b2 * a12) / det;
  const y = (a11 * b2 - a12 * b1) / det;
  return Math.hypot(x - vx, y - vy) <= JUNCTION_MAX_SHIFT_PX ? { x, y } : null;
}

type EdgeLine = {
  readonly px: number;
  readonly py: number;
  readonly dx: number;
  readonly dy: number;
};

// Principal line through the measured crack points 1..JUNCTION_REACH from one
// chain end (crack 0 touches the junction's three-colour pixels).
function endLine(chain: BoundaryChain, offsets: Float64Array, atStart: boolean): EdgeLine | null {
  const cracks = chain.dirs.length;
  const points: Vec2[] = [];
  for (let k = 1; k <= JUNCTION_REACH && k < cracks; k += 1) {
    const i = atStart ? k : cracks - 1 - k;
    points.push(crackPoint(chain, i, offsets[i] as number));
  }
  if (points.length < 2) return null;
  let mx = 0;
  let my = 0;
  for (const p of points) {
    mx += p.x;
    my += p.y;
  }
  mx /= points.length;
  my /= points.length;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of points) {
    sxx += (p.x - mx) ** 2;
    sxy += (p.x - mx) * (p.y - my);
    syy += (p.y - my) ** 2;
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { px: mx, py: my, dx: Math.cos(angle), dy: Math.sin(angle) };
}
