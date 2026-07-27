import { describe, expect, it } from 'vitest';

import { containmentDepths, type ContainmentSegment } from './containment-depth';

// The exhaustive comparison this module replaces, copied from optimize-paths as
// it stood before the index landed. It is the oracle: if the indexed version
// ever disagrees with it, "inside first" ordering has silently changed and cut
// order along with it.
function referenceDepths(segments: ReadonlyArray<ContainmentSegment>): number[] {
  const bounds = segments.map((segment) => {
    if (segment.polyline.length === 0) return null;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const p of segment.polyline) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    return { minX, minY, maxX, maxY };
  });
  return segments.map((_, i) => depthOf(segments, bounds, i));
}

type Box = { minX: number; minY: number; maxX: number; maxY: number };

function encloses(container: Box, target: Box): boolean {
  return (
    target.minX >= container.minX &&
    target.maxX <= container.maxX &&
    target.minY >= container.minY &&
    target.maxY <= container.maxY
  );
}

function depthOf(
  segments: ReadonlyArray<ContainmentSegment>,
  bounds: ReadonlyArray<Box | null>,
  i: number,
): number {
  const target = bounds[i] ?? null;
  if (target === null) return 0;
  const ref = { x: (target.minX + target.maxX) / 2, y: (target.minY + target.maxY) / 2 };
  let depth = 0;
  for (let j = 0; j < segments.length; j += 1) {
    if (i === j) continue;
    const container = segments[j];
    const box = bounds[j] ?? null;
    if (container === undefined || !container.closed || box === null) continue;
    if (!encloses(box, target)) continue;
    if (rayCast(ref, container.polyline)) depth += 1;
  }
  return depth;
}

function rayCast(
  point: { x: number; y: number },
  polygon: ReadonlyArray<{ x: number; y: number }>,
) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if (a === undefined || b === undefined) continue;
    if (a.y > point.y === b.y > point.y) continue;
    const xAtY = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (point.x < xAtY) inside = !inside;
  }
  return inside;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rect(x: number, y: number, w: number, h: number, closed = true): ContainmentSegment {
  return {
    closed,
    polyline: [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
      { x, y },
    ],
  };
}

describe('containmentDepths', () => {
  it('counts nested rings', () => {
    // Three concentric squares plus an open path that can never be a container.
    const segments = [
      rect(0, 0, 100, 100),
      rect(10, 10, 80, 80),
      rect(20, 20, 60, 60),
      {
        closed: false,
        polyline: [
          { x: 40, y: 40 },
          { x: 60, y: 60 },
        ],
      },
    ];
    expect(containmentDepths(segments)).toEqual([0, 1, 2, 3]);
  });

  it('ignores open segments as containers', () => {
    const open = { closed: false, polyline: rect(0, 0, 100, 100).polyline };
    const inner = rect(10, 10, 10, 10);
    expect(containmentDepths([open, inner])).toEqual([0, 0]);
  });

  it('matches the exhaustive comparison on fuzzed layouts', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const random = seededRandom(seed);
      const segments: ContainmentSegment[] = [];
      // A page-sized outline exercises the oversized-container path.
      segments.push(rect(0, 0, 500, 500));
      for (let i = 0; i < 60; i += 1) {
        const x = random() * 400;
        const y = random() * 400;
        const w = 5 + random() * 90;
        const h = 5 + random() * 90;
        segments.push(rect(x, y, w, h, random() > 0.25));
      }
      // Deliberate exact nests, which is where tie/boundary handling matters.
      segments.push(rect(100, 100, 200, 200));
      segments.push(rect(120, 120, 160, 160));
      segments.push(rect(140, 140, 120, 120));

      expect(containmentDepths(segments), `seed ${seed}`).toEqual(referenceDepths(segments));
    }
  });

  it('handles empty input, empty polylines and identical bounds', () => {
    expect(containmentDepths([])).toEqual([]);
    expect(containmentDepths([{ closed: true, polyline: [] }])).toEqual([0]);

    // Two identical squares each contain the other's centre, so both read 1 -
    // the exhaustive version's behaviour, preserved.
    const twins = [rect(0, 0, 50, 50), rect(0, 0, 50, 50)];
    expect(containmentDepths(twins)).toEqual(referenceDepths(twins));
  });

  it('falls back to an exhaustive check when a coordinate is not finite', () => {
    const segments = [
      rect(0, 0, 100, 100),
      {
        closed: true,
        polyline: [
          { x: Number.NaN, y: 0 },
          { x: 5, y: 5 },
          { x: 0, y: 5 },
        ],
      },
      rect(10, 10, 10, 10),
    ];
    expect(containmentDepths(segments)).toEqual(referenceDepths(segments));
  });
});
