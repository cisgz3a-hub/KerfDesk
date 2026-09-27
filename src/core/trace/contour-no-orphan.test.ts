// The no-orphan invariant (ADR-488 amendment 1): every boundary loop the area
// policy admits comes out of finishing and topology repair as exactly one
// ring, with its source orientation and its source nesting depth. A hole
// therefore never outlives its outer, and under even-odd or nonzero fill no
// hole paints as ink.

import { describe, expect, it } from 'vitest';
import type { Polyline, Vec2 } from '../scene';
import type { InkMask } from './centerline';
import { traceBoundaryLoops, type BoundaryLoop } from './contour-boundary';
import { createSaddleResolver, type TurnPolicy } from './saddle-connectivity';
import { contourPolylinesFromMask, isAdmittedLoop } from './contour-trace';
import type { RawImageData, TraceOptions } from './trace-image';
import { traceImageToColoredPaths } from './trace-to-paths';
import { TRACE_PRESETS } from './trace-presets';

type Nest = { readonly name: string; readonly rows: ReadonlyArray<string> };

// '#' is ink. Every nest holds a hole (the diagonal ring only when ink
// connects at saddles), and several have loops that collapse in the
// finishing tail at a coarse tolerance (thin bands, slits).
const NESTS: ReadonlyArray<Nest> = [
  {
    name: 'outer with two holes',
    rows: [
      '................',
      '.##############.',
      '.#....####....#.',
      '.#....####....#.',
      '.#....####....#.',
      '.##############.',
      '................',
    ],
  },
  {
    name: 'island in a hole in an outer',
    rows: [
      '..............',
      '.############.',
      '.#..........#.',
      '.#..######..#.',
      '.#..#....#..#.',
      '.#..#.##.#..#.',
      '.#..#.##.#..#.',
      '.#..#....#..#.',
      '.#..######..#.',
      '.#..........#.',
      '.############.',
      '..............',
    ],
  },
  {
    // A 3 px band around a 1 px slit: both loops are slivers, so a coarse
    // tolerance collapses the outer and the hole in the finishing tail.
    name: 'thin band around a slit',
    rows: [
      '..................................',
      '.################################.',
      '.#..............................#.',
      '.################################.',
      '..................................',
    ],
  },
  {
    // 1 px rings, three deep, around a surviving centre dot.
    name: 'thin concentric rings',
    rows: [
      '.................',
      '.###############.',
      '.#.............#.',
      '.#.###########.#.',
      '.#.#.........#.#.',
      '.#.#.#######.#.#.',
      '.#.#.#.....#.#.#.',
      '.#.#.#.###.#.#.#.',
      '.#.#.#.###.#.#.#.',
      '.#.#.#.....#.#.#.',
      '.#.#.#######.#.#.',
      '.#.#.........#.#.',
      '.#.###########.#.',
      '.#.............#.',
      '.###############.',
      '.................',
    ],
  },
  {
    // A 1 px diagonal ring (a diamond) around a hole: the outer is a
    // hairline loop, the hole a broad one.
    name: 'diagonal hairline ring',
    rows: [
      '...........',
      '.....#.....',
      '....#.#....',
      '...#...#...',
      '..#.....#..',
      '.#.......#.',
      '..#.....#..',
      '...#...#...',
      '....#.#....',
      '.....#.....',
      '...........',
    ],
  },
];

function maskOf(rows: ReadonlyArray<string>, scale = 1): InkMask {
  const height = rows.length * scale;
  const width = (rows[0]?.length ?? 0) * scale;
  const ink = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      ink[y * width + x] = rows[Math.floor(y / scale)]?.[Math.floor(x / scale)] === '#' ? 1 : 0;
    }
  }
  return { width, height, ink };
}

function signedArea(points: ReadonlyArray<Vec2>): number {
  let twice = 0;
  points.forEach((a, i) => {
    const b = points[(i + 1) % points.length] as Vec2;
    twice += a.x * b.y - b.x * a.y;
  });
  return twice / 2;
}

function contains(ring: ReadonlyArray<Vec2>, p: Vec2): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i] as Vec2;
    const b = ring[j] as Vec2;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      hit = !hit;
    }
  }
  return hit;
}

// Nesting depth of each ring among the others, by a majority of its vertices
// (finished rings may touch a neighbour at a vertex, never cross it).
function depths(rings: ReadonlyArray<ReadonlyArray<Vec2>>): number[] {
  return rings.map((ring, i) =>
    rings.reduce((depth, other, j) => {
      if (i === j) return depth;
      const inside = ring.filter((p) => contains(other, p)).length;
      return inside * 2 > ring.length ? depth + 1 : depth;
    }, 0),
  );
}

/** Rings whose orientation disagrees with their depth parity: holes that
 *  would paint as ink, or outers that would paint as paper. */
function orphans(rings: ReadonlyArray<ReadonlyArray<Vec2>>): number {
  const depth = depths(rings);
  const outerSign = Math.sign(signedArea(rings[depth.indexOf(0)] ?? []));
  return rings.filter((ring, i) => {
    const expected = (depth[i] ?? 0) % 2 === 0 ? outerSign : -outerSign;
    return Math.sign(signedArea(ring)) !== expected;
  }).length;
}

function admitted(mask: InkMask, minAreaPx: number, turnPolicy?: TurnPolicy): BoundaryLoop[] {
  const saddles = turnPolicy === undefined ? undefined : createSaddleResolver(mask, turnPolicy);
  return traceBoundaryLoops(mask, saddles).filter((loop) => isAdmittedLoop(loop, minAreaPx));
}

const ring = (polyline: Polyline): ReadonlyArray<Vec2> => polyline.points.slice(0, -1);

// Fine, preset-like and coarse finishing tolerances (px); the coarse ones
// collapse every sliver loop above to its fallback.
const EPSILONS = [0.1, 0.45, 1.8, 6] as const;
// The diagonal ring is one loop only when ink connects at saddles.
const RUNS: ReadonlyArray<readonly [number, TurnPolicy]> = [
  [1, 'connect-paper'],
  [1, 'connect-ink'],
  [2, 'connect-ink'],
];

describe('no-orphan invariant: one loop out per admitted loop in', () => {
  for (const nest of NESTS) {
    for (const [scale, turnPolicy] of RUNS) {
      for (const epsilonPx of EPSILONS) {
        it(`${nest.name} at ${scale}x, ${turnPolicy}, tolerance ${epsilonPx} px`, () => {
          const mask = maskOf(nest.rows, scale);
          const loops = admitted(mask, 0, turnPolicy);
          expect(loops.length).toBeGreaterThanOrEqual(2);
          const out = contourPolylinesFromMask(mask, {
            minAreaPx: 0,
            epsilonPx: epsilonPx * scale,
            flattenStrength: 0,
            pixelScale: scale,
            turnPolicy,
          });
          // One ring per admitted loop, in loop order, each closed.
          expect(out).toHaveLength(loops.length);
          out.forEach((polyline, index) => {
            expect(polyline.closed).toBe(true);
            expect(polyline.points.at(-1)).toEqual(polyline.points[0]);
            // Orientation is the source loop's: a hole stays a hole.
            const source = loops[index] as BoundaryLoop;
            expect(Math.sign(signedArea(ring(polyline))), `${index}`).toBe(Math.sign(source.area));
          });
          // Nesting depth is the source loop's, so depth parity is orientation.
          expect(depths(out.map(ring))).toEqual(depths(loops.map((loop) => loop.points)));
          expect(orphans(out.map(ring))).toBe(0);
        });
      }
    }
  }
});

describe('the area gate drops a whole subtree or nothing', () => {
  it('drops a hole with its outer, never the outer alone', () => {
    const mask = maskOf(NESTS[1]?.rows ?? []);
    const areas = traceBoundaryLoops(mask).map((loop) => Math.abs(loop.area));
    for (const minAreaPx of [0, ...areas, ...areas.map((area) => area + 0.5)]) {
      const loops = admitted(mask, minAreaPx);
      const kept = contourPolylinesFromMask(mask, {
        minAreaPx,
        epsilonPx: 0.45,
        flattenStrength: 0,
      });
      expect(kept).toHaveLength(loops.length);
      if (kept.length > 0) expect(orphans(kept.map(ring))).toBe(0);
      // Enclosed area is monotone down the nesting, so every loop enclosing
      // an admitted loop is admitted too: the gate keeps ancestors closed.
      const all = traceBoundaryLoops(mask);
      for (const inner of loops) {
        for (const outer of all) {
          const encloses =
            outer !== inner &&
            inner.points.filter((p) => contains(outer.points, p)).length * 2 > inner.points.length;
          if (encloses) expect(isAdmittedLoop(outer, minAreaPx)).toBe(true);
        }
      }
    }
  });

  it('never admits a loop that encloses nothing', () => {
    const empty: BoundaryLoop = {
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      area: 0,
    };
    expect(isAdmittedLoop(empty, 0)).toBe(false);
    expect(isAdmittedLoop({ ...empty, area: Number.NaN }, 0)).toBe(false);
    expect(isAdmittedLoop({ ...empty, area: -1 }, 1)).toBe(true);
    expect(isAdmittedLoop({ ...empty, area: 0.99 }, 1)).toBe(false);
  });
});

function imageOf(rows: ReadonlyArray<string>, scale: number): RawImageData {
  const mask = maskOf(rows, scale);
  const data = new Uint8ClampedArray(mask.width * mask.height * 4);
  mask.ink.forEach((value, i) => {
    const level = value === 1 ? 20 : 245;
    data.set([level, level, level, 255], i * 4);
  });
  return { width: mask.width, height: mask.height, data };
}

describe('no-orphan invariant through the contour presets', () => {
  for (const preset of ['Line Art', 'Smooth', 'Sharp'] as const) {
    it(`${preset}: every traced ring's orientation matches its depth parity`, async () => {
      for (const nest of NESTS) {
        const options = TRACE_PRESETS[preset] as TraceOptions;
        const paths = await traceImageToColoredPaths(imageOf(nest.rows, 6), options);
        const rings = paths
          .flatMap((path) => path.polylines)
          .filter((polyline) => polyline.closed)
          .map(ring);
        expect(rings.length, nest.name).toBeGreaterThanOrEqual(2);
        expect(orphans(rings), nest.name).toBe(0);
      }
    });
  }
});
