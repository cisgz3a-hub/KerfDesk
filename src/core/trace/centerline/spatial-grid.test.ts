import { describe, expect, it } from 'vitest';
import { SegmentGrid, type GridSegment } from './spatial-grid';

function seg(
  ownerId: number,
  segIndex: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): GridSegment {
  return { ownerId, segIndex, a: { x: ax, y: ay }, b: { x: bx, y: by } };
}

// Reference: the naive scan the grid replaces — every segment within `reach`
// of the query point (measured to the segment, as callers do).
function naiveWithin(
  segs: ReadonlyArray<GridSegment>,
  p: { x: number; y: number },
  reach: number,
): Set<string> {
  const hit = new Set<string>();
  for (const s of segs) {
    if (pointToSegment(p, s.a, s.b) <= reach) hit.add(`${s.ownerId}:${s.segIndex}`);
  }
  return hit;
}

function pointToSegment(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

describe('SegmentGrid', () => {
  it('returns a superset of the segments within reach (never misses one)', () => {
    const reach = 4;
    const segs: GridSegment[] = [];
    // A deterministic scatter of segments across a 100x100 field.
    for (let i = 0; i < 200; i += 1) {
      const ax = (i * 37) % 100;
      const ay = (i * 53) % 100;
      const bx = (ax + ((i * 7) % 11)) % 100;
      const by = (ay + ((i * 13) % 9)) % 100;
      segs.push(seg(i, 0, ax, ay, bx, by));
    }
    const grid = new SegmentGrid(reach);
    for (const s of segs) grid.insert(s);

    for (let q = 0; q < 50; q += 1) {
      const p = { x: (q * 41) % 100, y: (q * 29) % 100 };
      const truth = naiveWithin(segs, p, reach);
      const returned = new Set(grid.query(p, reach).map((s) => `${s.ownerId}:${s.segIndex}`));
      for (const id of truth) expect(returned.has(id)).toBe(true);
    }
  });

  it('handles negative coordinates', () => {
    const grid = new SegmentGrid(4);
    grid.insert(seg(1, 0, -20, -20, -18, -18));
    grid.insert(seg(2, 0, 50, 50, 52, 52));
    const near = grid.query({ x: -19, y: -19 }, 4).map((s) => s.ownerId);
    expect(near).toContain(1);
    expect(near).not.toContain(2);
  });

  it('finds a segment that spans multiple cells', () => {
    const grid = new SegmentGrid(2);
    grid.insert(seg(7, 0, 0, 0, 40, 0)); // long horizontal segment
    // Query near the far end — the segment must be reachable there.
    const near = grid.query({ x: 38, y: 0.5 }, 2).map((s) => s.ownerId);
    expect(near).toContain(7);
  });
});
