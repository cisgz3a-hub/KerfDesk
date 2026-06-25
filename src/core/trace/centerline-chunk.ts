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
  const e0 = exits[0];
  const e1 = exits[1];
  if (exits.length === 2 && e0 !== undefined && e1 !== undefined) return [[e0, e1]];
  const center = inkCentroid(mask, width, c);
  if (center === null || e0 === undefined) return [];
  if (exits.length === 1) return [[e0, center]];
  return exits.map((exit) => [center, exit]); // crossroad
}
