// Base case of the divide-and-conquer centerline tracer (ADR-058): turn the
// skeleton inside one small chunk into segments, joined by WHERE strokes cross
// the chunk's border. The graph-walk approach we replaced classified each pixel
// by 8-neighbour degree, which over-reports junctions on curves and shatters
// smooth strokes. Reading border crossings instead is immune to those
// imperfections: a stroke that merely passes through a chunk is one entry + one
// exit, regardless of any spurious skeleton bumps inside.
//
// Exit count -> segments: 0 -> none; 1 -> a stub from the exit to the chunk's
// ink centroid; 2 -> one segment joining the two crossings (a small chunk is
// ~straight); >=3 -> a crossroad, every exit joined to the centroid.

import type { Vec2 } from '../scene';

export type Chunk = {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
};

// A 2-exit chunk whose ink strays more than this off the straight chord is a
// corner, not a gentle curve — route through the bend so the corner survives.
const CORNER_MIN_PX = 1;

function isInk(mask: Uint8Array, width: number, x: number, y: number): boolean {
  return (mask[y * width + x] ?? 0) === 1;
}

// Clockwise loop of the chunk's border pixel coordinates (top, right, bottom,
// left), each border pixel listed once.
function borderLoop(c: Chunk): Vec2[] {
  const pts: Vec2[] = [];
  const x1 = c.x + c.w - 1;
  const y1 = c.y + c.h - 1;
  for (let x = c.x; x <= x1; x += 1) pts.push({ x, y: c.y });
  for (let y = c.y + 1; y <= y1; y += 1) pts.push({ x: x1, y });
  if (c.h > 1) for (let x = x1 - 1; x >= c.x; x -= 1) pts.push({ x, y: y1 });
  if (c.w > 1) for (let y = y1 - 1; y > c.y; y -= 1) pts.push({ x: c.x, y });
  return pts;
}

// Distinct border crossings: the midpoint of each maximal run of skeleton pixels
// around the (cyclic) border loop.
export function chunkExits(mask: Uint8Array, width: number, c: Chunk): Vec2[] {
  const loop = borderLoop(c);
  const n = loop.length;
  if (n === 0) return [];
  const skel = loop.map((p) => isInk(mask, width, p.x, p.y));
  const start = skel.indexOf(false);
  if (start < 0) {
    const first = loop[0];
    return first === undefined ? [] : [first]; // entire border is ink: one exit
  }
  const exits: Vec2[] = [];
  let i = 0;
  while (i < n) {
    if (skel[(start + i) % n] !== true) {
      i += 1;
      continue;
    }
    const runStart = i;
    while (i < n && skel[(start + i) % n] === true) i += 1;
    const mid = loop[(start + ((runStart + i - 1) >> 1)) % n];
    if (mid !== undefined) exits.push(mid);
  }
  return exits;
}

export function inkCentroid(mask: Uint8Array, width: number, c: Chunk): Vec2 | null {
  let sx = 0;
  let sy = 0;
  let count = 0;
  for (let y = c.y; y < c.y + c.h; y += 1) {
    for (let x = c.x; x < c.x + c.w; x += 1) {
      if (isInk(mask, width, x, y)) {
        sx += x;
        sy += y;
        count += 1;
      }
    }
  }
  return count === 0 ? null : { x: sx / count, y: sy / count };
}

export function chunkSegments(mask: Uint8Array, width: number, c: Chunk): Vec2[][] {
  const exits = chunkExits(mask, width, c);
  const ink = chunkInkPixels(mask, width, c);
  const e0 = exits[0];
  const e1 = exits[1];
  if (exits.length === 2 && e0 !== undefined && e1 !== undefined) {
    const bend = furthestFromLine(ink, e0, e1);
    if (bend !== null && distToLineSq(bend, e0, e1) > CORNER_MIN_PX * CORNER_MIN_PX) {
      return [[e0, bend, e1]]; // corner: route through the bend
    }
    return [[e0, e1]];
  }
  if (exits.length === 1 && e0 !== undefined) {
    // A stroke ending inside the chunk: draw to the actual tip (furthest ink
    // pixel from the entry), not the centroid — otherwise we stop short of the
    // true endpoint and leave a coverage gap.
    const tip = furthestFrom(ink, e0);
    return tip === null ? [] : [[e0, tip]];
  }
  if (exits.length === 0) {
    const span = inkDiameter(ink); // isolated stroke fully inside: span its extent
    return span === null ? [] : [span];
  }
  const center = inkCentroid(mask, width, c);
  return center === null ? [] : exits.map((exit) => [center, exit]); // crossroad
}

function furthestFromLine(ink: ReadonlyArray<Vec2>, a: Vec2, b: Vec2): Vec2 | null {
  let best: Vec2 | null = null;
  let bestD = -1;
  for (const p of ink) {
    const d = distToLineSq(p, a, b);
    if (d > bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

function distToLineSq(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return (p.x - a.x) ** 2 + (p.y - a.y) ** 2;
  const cross = (p.x - a.x) * dy - (p.y - a.y) * dx;
  return (cross * cross) / len2;
}

function chunkInkPixels(mask: Uint8Array, width: number, c: Chunk): Vec2[] {
  const out: Vec2[] = [];
  for (let y = c.y; y < c.y + c.h; y += 1) {
    for (let x = c.x; x < c.x + c.w; x += 1) {
      if (isInk(mask, width, x, y)) out.push({ x, y });
    }
  }
  return out;
}

function furthestFrom(ink: ReadonlyArray<Vec2>, from: Vec2): Vec2 | null {
  let best: Vec2 | null = null;
  let bestD = -1;
  for (const p of ink) {
    const d = (p.x - from.x) ** 2 + (p.y - from.y) ** 2;
    if (d > bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

function inkDiameter(ink: ReadonlyArray<Vec2>): Vec2[] | null {
  const seed = ink[0];
  if (seed === undefined) return null;
  const a = furthestFrom(ink, seed);
  const b = a === null ? null : furthestFrom(ink, a);
  return a === null || b === null ? null : [a, b];
}
