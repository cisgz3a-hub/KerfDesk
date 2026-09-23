import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { grblStrategy } from '../output/grbl-strategy';
import {
  createLayer,
  DEFAULT_PROJECT_OPTIMIZATION,
  IDENTITY_TRANSFORM,
  type Layer,
  type Scene,
} from '../scene';
import { compileJob } from './compile-job';
import type { CutGroup, CutSegment, Job } from './job';
import { optimizePaths } from './optimize-paths';
import { removeCutOverlaps } from './remove-cut-overlaps';

const options = {
  ...DEFAULT_PROJECT_OPTIMIZATION,
  travelPolicy: 'source-order' as const,
  removeOverlappingLines: true,
};
const device = DEFAULT_DEVICE_PROFILE;
const path = (...points: Array<readonly [number, number]>): CutSegment => ({
  closed: false,
  polyline: points.map(([x, y]) => ({ x, y })),
});
const square = (x = 0): CutSegment => ({
  ...path([x, 0], [x + 10, 0], [x + 10, 10], [x, 10], [x, 0]),
  closed: true,
});
const group = (segments: CutSegment[], patch: Partial<CutGroup> = {}): CutGroup => ({
  kind: 'cut',
  layerId: 'line',
  color: '#000000',
  power: 50,
  speed: 1000,
  passes: 1,
  airAssist: false,
  segments,
  ...patch,
});
const length = (segments: ReadonlyArray<CutSegment>): number =>
  segments.reduce(
    (sum, segment) =>
      sum +
      segment.polyline
        .slice(1)
        .reduce(
          (part, point, i) =>
            part + Math.hypot(point.x - segment.polyline[i]!.x, point.y - segment.polyline[i]!.y),
          0,
        ),
    0,
  );

// Independently read the emitted XY/S/G modal stream. This counts powered motion,
// not the compiler's own distance summary, and includes repeated passes.
function emittedBurnMm(job: Job): number {
  const gcode = grblStrategy.emit(job, device, { compactMotionWords: false, finishPosition: null });
  let x = 0;
  let y = 0;
  let s = 0;
  let motion = 0;
  let burn = 0;
  for (const line of gcode.split('\n')) {
    const code = line.split(';')[0]!;
    const word = (letter: string): number | undefined => {
      const match = code.match(new RegExp(`(?:^| )${letter}(-?[\\d.]+)`));
      return match ? Number(match[1]) : undefined;
    };
    const g = word('G');
    if (g === 0 || g === 1) motion = g;
    s = word('S') ?? s;
    const nextX = word('X') ?? x;
    const nextY = word('Y') ?? y;
    if (motion === 1 && s > 0) burn += Math.hypot(nextX - x, nextY - y);
    x = nextX;
    y = nextY;
  }
  return burn;
}

describe('opt-in laser line overlap removal', () => {
  it('preserves default output, but removes duplicate contours without reducing passes', () => {
    const job = { groups: [group([square(), square()], { passes: 2 })] };
    expect(emittedBurnMm(optimizePaths(job))).toBe(160);
    const cleaned = optimizePaths(job, options);
    expect(emittedBurnMm(cleaned)).toBe(80);
    expect(cleaned.groups[0]).toMatchObject({ passes: 2, segments: [square()] });
  });

  it.each([path([5, 0], [15, 0]), path([15, 0], [5, 0])])(
    'keeps only the uncovered part in the requested direction',
    (overlap) => {
      const cleaned = removeCutOverlaps(group([path([0, 0], [10, 0]), overlap]));
      expect(length(cleaned.segments)).toBe(15);
      const remainder = cleaned.segments[1]!.polyline;
      expect(remainder).toEqual(
        overlap.polyline[0]!.x === 15
          ? [
              { x: 15, y: 0 },
              { x: 10, y: 0 },
            ]
          : [
              { x: 10, y: 0 },
              { x: 15, y: 0 },
            ],
      );
      expect(emittedBurnMm({ groups: [cleaned] })).toBe(15);
    },
  );

  it('removes one shared edge of adjacent closed contours without bridging the missing edge', () => {
    const cleaned = removeCutOverlaps(group([square(), square(10)]));
    expect(length(cleaned.segments)).toBe(70);
    expect(emittedBurnMm({ groups: [cleaned] })).toBe(70);
    expect(cleaned.segments[0]!.closed).toBe(true);
    expect(cleaned.segments.slice(1).every((segment) => !segment.closed)).toBe(true);
  });

  it('handles vertical and diagonal overlap without consuming near-parallel or crossing lines', () => {
    const segments = [
      path([0, 0], [0, 10]),
      path([0, 5], [0, 15]),
      path([0, 0], [10, 10]),
      path([5, 5], [15, 15]),
      path([0.001, 0], [0.001, 10]),
      path([-1, 3], [1, 3]),
    ];
    expect(length(removeCutOverlaps(group(segments)).segments)).toBeCloseTo(27 + 15 * Math.SQRT2);
  });

  it('leaves deliberate retracing inside one contour and separate settings/operations intact', () => {
    const retrace = path([0, 0], [10, 0], [0, 0]);
    expect(length(removeCutOverlaps(group([retrace, path([0, 0], [10, 0])])).segments)).toBe(20);
    const first = group([square(), square()]);
    const job = {
      groups: [first, { ...first, power: 80 }, { ...first, layerId: 'repeat', passes: 3 }],
    };
    const cleaned = optimizePaths(job, options);
    expect(
      cleaned.groups.map((g) => (g.kind === 'cut' ? [g.layerId, g.power, g.passes] : null)),
    ).toEqual([
      ['line', 50, 1],
      ['line', 80, 1],
      ['repeat', 50, 3],
    ]);
    expect(emittedBurnMm(cleaned)).toBe(200);
  });

  it.each([
    { tabsEnabled: true, tabsPerShape: 4, tabSizeMm: 2, expected: 32 },
    { kerfOffsetMm: 0.5, expected: 44 },
  ])('operates on final tabs/kerf geometry: %j', ({ expected, ...settings }) => {
    const layer: Layer = { ...createLayer({ id: 'line', color: '#000000' }), ...settings };
    const scene: Scene = {
      objects: ['a', 'b'].map((id) => ({
        kind: 'imported-svg',
        id,
        source: 'square.svg',
        bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
        transform: IDENTITY_TRANSFORM,
        paths: [
          {
            color: layer.color,
            operationIds: [layer.id],
            polylines: [{ points: square().polyline, closed: true }],
          },
        ],
      })),
      layers: [layer],
    };
    const job = compileJob(scene, device);
    expect(emittedBurnMm(optimizePaths(job, options))).toBeCloseTo(expected);
  });

  it('preserves laser-off contour entry and skips CNC timing projections', () => {
    const cut = group([square(), square()], { entryRunwayMm: 5 });
    expect(emittedBurnMm(optimizePaths({ groups: [cut] }, options))).toBe(40);
    const cnc = group(
      cut.segments.map((segment) => ({ ...segment, plannerCoordinatesRepresented: true })),
    );
    expect(removeCutOverlaps(cnc)).toBe(cnc);
  });

  it('matches independently counted unit-interval coverage for arbitrarily ordered overlaps', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: -20, max: 20 }), fc.integer({ min: -20, max: 20 })), {
          minLength: 2,
          maxLength: 60,
        }),
        (intervals) => {
          const expected = new Set<number>();
          for (const [a, b] of intervals)
            for (let x = Math.min(a, b); x < Math.max(a, b); x += 1) expected.add(x);
          const segments = intervals.map(([a, b]) => path([a, 0], [b, 0]));
          expect(length(removeCutOverlaps(group(segments)).segments)).toBe(expected.size);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('handles a large reversed disjoint collinear set without an all-pairs comparison', () => {
    const segments = Array.from({ length: 10000 }, (_, i) =>
      path([i * 2, 0], [i * 2 + 1, 0]),
    ).reverse();
    expect(removeCutOverlaps(group(segments)).segments).toEqual(segments);
  });
});
