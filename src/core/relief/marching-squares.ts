// Clean-room marching squares (Phase H.5, ADR-094): boolean cell mask →
// closed iso-contours on the dual grid. Each 2×2 cell block maps through the
// classic 16-case table; segments chain into closed loops by walking shared
// edge midpoints. Saddles (cases 5/10) resolve by a FIXED rule (treat as
// disconnected), so output is deterministic for any input.
//
// Coordinates are CELL units on the dual grid (contour point (x, y) sits
// between mask cells); callers scale into mm. Contours wind consistently
// (inside on the left) because the case table is built that way.

import type { Polyline, Vec2 } from '../scene';

type Segment = {
  readonly ax: number;
  readonly ay: number;
  readonly bx: number;
  readonly by: number;
};

export function marchingSquares(
  mask: Uint8Array,
  widthCells: number,
  heightCells: number,
): ReadonlyArray<Polyline> {
  const segments = collectSegments(mask, widthCells, heightCells);
  return chainSegments(segments);
}

function at(mask: Uint8Array, w: number, h: number, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= w || y >= h) return 0; // outside = empty
  return (mask[y * w + x] ?? 0) !== 0 ? 1 : 0;
}

// Walk every dual-grid cell (including a 1-cell border so contours close
// around mask edges) and emit the case-table segments.
function collectSegments(mask: Uint8Array, w: number, h: number): Segment[] {
  const segments: Segment[] = [];
  for (let y = -1; y < h; y += 1) {
    for (let x = -1; x < w; x += 1) {
      const tl = at(mask, w, h, x, y);
      const tr = at(mask, w, h, x + 1, y);
      const br = at(mask, w, h, x + 1, y + 1);
      const bl = at(mask, w, h, x, y + 1);
      const code = tl * 8 + tr * 4 + br * 2 + bl;
      appendCaseSegments(segments, code, x, y);
    }
  }
  return segments;
}

// The 16-case table as data: per corner code (tl·8 + tr·4 + br·2 + bl), the
// segments to emit between edge midpoints, running with the filled region on
// the LEFT of a→b. Saddles (5, 10) resolve as disconnected corners.
type EdgeName = 'top' | 'right' | 'bottom' | 'left';
const CASE_SEGMENTS: ReadonlyArray<ReadonlyArray<readonly [EdgeName, EdgeName]>> = [
  /* 0  */ [],
  /* 1  */ [['left', 'bottom']],
  /* 2  */ [['bottom', 'right']],
  /* 3  */ [['left', 'right']],
  /* 4  */ [['right', 'top']],
  /* 5  */ [
    ['right', 'top'],
    ['left', 'bottom'],
  ],
  /* 6  */ [['bottom', 'top']],
  /* 7  */ [['left', 'top']],
  /* 8  */ [['top', 'left']],
  /* 9  */ [['top', 'bottom']],
  /* 10 */ [
    ['top', 'right'],
    ['bottom', 'left'],
  ],
  /* 11 */ [['top', 'right']],
  /* 12 */ [['right', 'left']],
  /* 13 */ [['right', 'bottom']],
  /* 14 */ [['bottom', 'left']],
  /* 15 */ [],
];

// Edge midpoints of the 2×2 block whose corners are cell CENTERS at
// (x+0.5, y+0.5) … (x+1.5, y+1.5): top/right/bottom/left midpoints.
function appendCaseSegments(out: Segment[], code: number, x: number, y: number): void {
  const edges: Record<EdgeName, Vec2> = {
    top: { x: x + 1, y: y + 0.5 },
    right: { x: x + 1.5, y: y + 1 },
    bottom: { x: x + 1, y: y + 1.5 },
    left: { x: x + 0.5, y: y + 1 },
  };
  for (const [a, b] of CASE_SEGMENTS[code] ?? []) {
    out.push({ ax: edges[a].x, ay: edges[a].y, bx: edges[b].x, by: edges[b].y });
  }
}

// Chain segments a→b end-to-start into closed loops. Keys quantize to half
// cells exactly (all coordinates are multiples of 0.5), so string keys are
// exact and deterministic. Every segment belongs to exactly one loop because
// each point has exactly one outgoing and one incoming segment (guaranteed
// by the winding-consistent case table; saddles contribute two distinct
// outgoing points).
function chainSegments(segments: ReadonlyArray<Segment>): ReadonlyArray<Polyline> {
  const byStart = new Map<string, Segment[]>();
  for (const s of segments) {
    const key = pointKey(s.ax, s.ay);
    const list = byStart.get(key);
    if (list === undefined) byStart.set(key, [s]);
    else list.push(s);
  }
  const used = new Set<Segment>();
  const loops: Polyline[] = [];
  for (const seed of segments) {
    if (used.has(seed)) continue;
    const points: Vec2[] = [{ x: seed.ax, y: seed.ay }];
    let current = seed;
    used.add(current);
    for (;;) {
      points.push({ x: current.bx, y: current.by });
      if (current.bx === seed.ax && current.by === seed.ay) break;
      const candidates = byStart.get(pointKey(current.bx, current.by));
      const next = candidates?.find((s) => !used.has(s));
      if (next === undefined) break; // open chain (shouldn't happen; be safe)
      used.add(next);
      current = next;
    }
    if (points.length >= 4) loops.push({ closed: true, points });
  }
  return loops;
}

function pointKey(x: number, y: number): string {
  return `${x * 2}|${y * 2}`; // integers after ×2 — exact keys
}
