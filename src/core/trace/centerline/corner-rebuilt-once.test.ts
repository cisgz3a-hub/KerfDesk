// A drawn corner in a centreline stroke is rebuilt once. After the rebuild,
// the next candidate along the chain sees the new corner inside its own
// window and used to build a second one from a tangent read further down the
// other leg (ADR-558).

import { describe, expect, it } from 'vitest';
import type { Polyline, Vec2 } from '../../scene';
import type { RawImageData, TraceOptions } from '../trace-image';
import { traceCenterlineStrokePaths } from './trace-centerline';

const SIZE = 180;
const RADIUS = 6; // a 12 px stroke
const VERTEX: Vec2 = { x: 110, y: 90 };
// The pen turns 45° at the vertex; neither leg runs along the pixel grid.
const PEN_PATH: ReadonlyArray<Vec2> = [
  { x: 165.2303, y: 113.4439 },
  VERTEX,
  { x: 87.5236, y: 34.369 },
];

const CENTERLINE_OPTIONS: TraceOptions = {
  traceMode: 'centerline',
  numberOfColors: 2,
  pathOmit: 0,
  lineTolerance: 1,
  quadraticTolerance: 1,
  blurRadius: 0,
  blurDelta: 0,
  lineFilter: true,
  fixedPalette: ['#ffffff', '#000000'],
  useOtsuThreshold: true,
  despeckleMinPixels: 4,
  centerlineJoinGapPx: 3,
};

function distanceToPath(p: Vec2, path: ReadonlyArray<Vec2>): number {
  let best = Infinity;
  for (let k = 1; k < path.length; k += 1) {
    const a = path[k - 1]!;
    const b = path[k]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
}

// Share of a pixel a round nib of RADIUS along the pen path covers, from a
// 16 x 16 grid of samples where the edge crosses it.
function coverage(x: number, y: number): number {
  const centre = distanceToPath({ x: x + 0.5, y: y + 0.5 }, PEN_PATH);
  if (centre <= RADIUS - 0.75) return 1;
  if (centre >= RADIUS + 0.75) return 0;
  let inside = 0;
  for (let sy = 0; sy < 16; sy += 1) {
    for (let sx = 0; sx < 16; sx += 1) {
      const p = { x: x + (sx + 0.5) / 16, y: y + (sy + 0.5) / 16 };
      if (distanceToPath(p, PEN_PATH) <= RADIUS) inside += 1;
    }
  }
  return inside / 256;
}

// The stroke drawn anti-aliased, black on white.
function strokeImage(): RawImageData {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4).fill(255);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const i = y * SIZE + x;
      data.fill(Math.round(255 * (1 - coverage(x, y))), i * 4, i * 4 + 3);
    }
  }
  return { width: SIZE, height: SIZE, data };
}

// Worst distance from the traced line to the pen path around the bend.
function bendError(polyline: Polyline): number {
  let worst = 0;
  for (let k = 1; k < polyline.points.length; k += 1) {
    const a = polyline.points[k - 1]!;
    const b = polyline.points[k]!;
    for (let s = 0; s <= 10; s += 1) {
      const p = { x: a.x + ((b.x - a.x) * s) / 10, y: a.y + ((b.y - a.y) * s) / 10 };
      if (Math.hypot(p.x - VERTEX.x, p.y - VERTEX.y) > 20) continue;
      worst = Math.max(worst, distanceToPath(p, PEN_PATH));
    }
  }
  return worst;
}

describe('centreline corner rebuild', () => {
  it('rebuilds a 45° corner of a thick stroke once, on the pen path', () => {
    const traced = traceCenterlineStrokePaths(strokeImage(), CENTERLINE_OPTIONS).flatMap(
      (path) => path.polylines,
    );
    expect(traced).toHaveLength(1);
    // The second corner stood 3 px past the first and 1.46 px off the path.
    expect(bendError(traced[0]!)).toBeLessThan(1);
  });
});
