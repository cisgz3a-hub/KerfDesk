import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Polyline,
  type Vec2,
} from '../scene';
import { offsetShapes, type OffsetShapesOptions } from './offset-shapes';

const IDS = { outward: 'out', inward: 'in' };
const STYLES = ['round', 'bevel', 'corner'] as const;

function square(minX: number, minY: number, size: number): Polyline {
  return {
    closed: true,
    points: [
      { x: minX, y: minY },
      { x: minX + size, y: minY },
      { x: minX + size, y: minY + size },
      { x: minX, y: minY + size },
    ],
  };
}

function art(polylines: ReadonlyArray<Polyline>, id = 'art'): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: 'test.svg',
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#ff0000', polylines }],
  };
}

function options(patch: Partial<OffsetShapesOptions>): OffsetShapesOptions {
  return {
    distanceMm: 1,
    direction: 'outward',
    cornerStyle: 'round',
    outerShapesOnly: false,
    ...patch,
  };
}

function signedArea(points: ReadonlyArray<Vec2>): number {
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]!;
    const b = points[(index + 1) % points.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

// Outer rings and holes wind opposite ways, so the signed sum is the filled area.
function filledArea(object: ImportedSvg | null): number {
  if (object === null) return 0;
  const total = object.paths
    .flatMap((path) => path.polylines)
    .reduce((sum, polyline) => sum + signedArea(polyline.points), 0);
  return Math.abs(total);
}

function run(objects: ReadonlyArray<ImportedSvg>, patch: Partial<OffsetShapesOptions>) {
  const result = offsetShapes(objects, options(patch), IDS);
  if (result.kind !== 'ok') throw new Error(result.error.message);
  return result.value;
}

function openLine(...points: ReadonlyArray<Vec2>): Polyline {
  return { closed: false, points };
}

function segments(polyline: Polyline): Array<readonly [Vec2, Vec2]> {
  const { points } = polyline;
  const count = polyline.closed ? points.length : points.length - 1;
  return Array.from({ length: count }, (_, index) => [
    points[index]!,
    points[(index + 1) % points.length]!,
  ]);
}

function pointToSegment(point: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const along = lengthSq === 0 ? 0 : ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq;
  const t = Math.max(0, Math.min(1, along));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function cross(origin: Vec2, a: Vec2, b: Vec2): number {
  return (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
}

function segmentDistance(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number {
  const crosses = cross(c, d, a) * cross(c, d, b) < 0 && cross(a, b, c) * cross(a, b, d) < 0;
  if (crosses) return 0;
  return Math.min(
    pointToSegment(a, c, d),
    pointToSegment(b, c, d),
    pointToSegment(c, a, b),
    pointToSegment(d, a, b),
  );
}

// The nearest any point of the outline comes to the source. Whole edges are
// measured, not only vertices: a flat cap's corners sit exactly at the distance
// while the edge between them runs through the line's end.
function clearance(outline: ImportedSvg | null, source: ReadonlyArray<Polyline>): number {
  if (outline === null) throw new Error('the offset produced no object');
  const sourceEdges = source.flatMap(segments);
  let nearest = Number.POSITIVE_INFINITY;
  for (const [a, b] of outline.paths.flatMap((path) => path.polylines).flatMap(segments)) {
    for (const [c, d] of sourceEdges) nearest = Math.min(nearest, segmentDistance(a, b, c, d));
  }
  return nearest;
}

describe('offsetShapes corner styles', () => {
  const box = [art([square(0, 0, 10)])];

  it('rounds, bevels or keeps the outward corners of a square', () => {
    // LightBurn's Bevel cuts a right-angled corner off at the offset distance,
    // so each corner loses a triangle with legs of (1 - tan 22.5°) x distance.
    const bevelCut = (1 - Math.tan(Math.PI / 8)) ** 2 / 2;
    expect(filledArea(run(box, { cornerStyle: 'round' }).outward)).toBeCloseTo(140 + Math.PI, 1);
    expect(filledArea(run(box, { cornerStyle: 'bevel' }).outward)).toBeCloseTo(
      144 - 4 * bevelCut,
      2,
    );
    expect(filledArea(run(box, { cornerStyle: 'corner' }).outward)).toBeCloseTo(144, 2);
  });

  it('runs the flat sides of a bevel on past the corner, as LightBurn draws it', () => {
    const outline = run(box, { cornerStyle: 'bevel', distanceMm: 2 }).outward!;
    const topEdge = outline.paths[0]!.polylines[0]!.points.filter(
      (point) => Math.abs(point.y + 2) < 1e-9,
    );
    const xs = topEdge.map((point) => point.x);
    expect(Math.min(...xs)).toBeCloseTo(-2 * Math.tan(Math.PI / 8), 3);
    expect(Math.max(...xs)).toBeCloseTo(10 + 2 * Math.tan(Math.PI / 8), 3);
  });

  it('keeps every point of the outline the distance clear of the shape', () => {
    // An L has one concave corner, which takes the corner style inward.
    const ell: Polyline = {
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 8 },
        { x: 8, y: 8 },
        { x: 8, y: 20 },
        { x: 0, y: 20 },
      ],
    };
    for (const cornerStyle of STYLES) {
      const result = run([art([ell])], { direction: 'both', cornerStyle, distanceMm: 2 });
      for (const outline of [result.outward, result.inward]) {
        expect(clearance(outline, [ell])).toBeGreaterThan(2 - DEFAULT_MACHINE_CURVE_TOLERANCE_MM);
      }
    }
  });

  it('keeps sharp corners inward whatever the style, as LightBurn documents', () => {
    for (const cornerStyle of STYLES) {
      const result = run(box, { direction: 'inward', cornerStyle });
      expect(result.outward).toBeNull();
      expect(filledArea(result.inward)).toBeCloseTo(64, 2);
    }
  });

  it('makes two new objects for Both', () => {
    const result = run(box, { direction: 'both', cornerStyle: 'corner', distanceMm: 2 });
    expect(result.outward?.id).toBe('out');
    expect(result.inward?.id).toBe('in');
    expect(filledArea(result.outward)).toBeCloseTo(196, 2);
    expect(filledArea(result.inward)).toBeCloseTo(36, 2);
    expect(result.outward?.paths[0]?.color).toBe('#ff0000');
  });
});

describe('offsetShapes outer shapes only', () => {
  // A 20 mm frame with an 8 mm window and a 2 mm island inside the window.
  const frame = [art([square(0, 0, 20), square(6, 6, 8), square(9, 9, 2)])];

  it('keeps holes and islands by default', () => {
    const ringCount = run(frame, { cornerStyle: 'corner' }).outward!.paths[0]!.polylines.length;
    expect(ringCount).toBe(3);
  });

  it('offsets only the outer border when asked', () => {
    const outward = run(frame, { cornerStyle: 'corner', outerShapesOnly: true }).outward!;
    expect(outward.paths[0]!.polylines).toHaveLength(1);
    expect(filledArea(outward)).toBeCloseTo(22 * 22, 2);
  });
});

describe('offsetShapes open paths', () => {
  const line = [art([openLine({ x: 0, y: 0 }, { x: 10, y: 0 })])];

  it('outlines an open line outward with a round cap for Round and square caps otherwise', () => {
    expect(filledArea(run(line, { cornerStyle: 'round' }).outward)).toBeCloseTo(20 + Math.PI, 1);
    expect(filledArea(run(line, { cornerStyle: 'bevel' }).outward)).toBeCloseTo(24, 2);
    expect(filledArea(run(line, { cornerStyle: 'corner' }).outward)).toBeCloseTo(24, 2);
  });

  it('carries the outline the offset distance past both ends of a line for every style', () => {
    // A cut around a centreline trace must not clip the engraving at its ends.
    const trace = [art([openLine({ x: 0, y: 0 }, { x: 20, y: 0 })])];
    for (const cornerStyle of STYLES) {
      const { bounds } = run(trace, { cornerStyle, distanceMm: 2 }).outward!;
      expect(bounds.minX).toBeCloseTo(-2, 2);
      expect(bounds.maxX).toBeCloseTo(22, 2);
      expect(bounds.minY).toBeCloseTo(-2, 2);
      expect(bounds.maxY).toBeCloseTo(2, 2);
    }
  });

  it('keeps every point of the outline the distance clear of the line, ends included', () => {
    const lines: ReadonlyArray<Polyline> = [
      openLine({ x: 0, y: 0 }, { x: 20, y: 0 }),
      openLine({ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }),
      // A hairpin: the 17° turn is far past Corner's mitre limit.
      openLine({ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 0, y: 6 }),
    ];
    for (const source of lines) {
      for (const cornerStyle of STYLES) {
        const outline = run([art([source])], { cornerStyle, distanceMm: 2 }).outward;
        expect(clearance(outline, [source])).toBeGreaterThan(
          2 - DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
        );
      }
    }
  });

  it('merges open and closed shapes into one outward outline', () => {
    const mixed = [
      art([square(0, 0, 10)], 'a'),
      art(
        [
          {
            closed: false,
            points: [
              { x: 10, y: 5 },
              { x: 20, y: 5 },
            ],
          },
        ],
        'b',
      ),
    ];
    const outward = run(mixed, { cornerStyle: 'corner' }).outward!;
    expect(outward.paths[0]!.polylines).toHaveLength(1);
  });

  it('outlines only the open lines under Both', () => {
    const result = run(line, { direction: 'both' });
    expect(result.outward).not.toBeNull();
    expect(result.inward).toBeNull();
  });

  // Audit 2026-10-21 geometry P3-3: SVG `M0 0 L10 0 Z` and `<polygon points="0,0 10,0"/>`
  // import as closed paths with no area, which Offset used to drop silently.
  it('outlines a closed path with no area as the line it draws', () => {
    const closedLines: ReadonlyArray<Polyline> = [
      {
        closed: true,
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 0, y: 0 },
        ],
      },
      {
        closed: true,
        points: [
          { x: 0, y: 0 },
          { x: 5, y: 0 },
          { x: 10, y: 0 },
        ],
      },
    ];
    const open = run(line, { distanceMm: 2 }).outward!.bounds;
    for (const closedLine of closedLines) {
      const { bounds } = run([art([closedLine])], { distanceMm: 2 }).outward!;
      expect(bounds.minX).toBeCloseTo(open.minX, 3);
      expect(bounds.maxX).toBeCloseTo(open.maxX, 3);
      expect(bounds.minY).toBeCloseTo(open.minY, 3);
      expect(bounds.maxY).toBeCloseTo(open.maxY, 3);
    }
  });

  it('refuses, with a reason, a selection that has nothing to outline', () => {
    const point: Polyline = { closed: false, points: [{ x: 3, y: 3 }] };
    const result = offsetShapes([art([point])], options({}), IDS);
    expect(result.kind === 'error' && result.error.kind).toBe('empty-result');
    if (result.kind === 'error') expect(result.error.message).toMatch(/^Nothing to offset/);
  });

  it('explains that Inward needs a closed shape', () => {
    const result = offsetShapes(line, options({ direction: 'inward' }), IDS);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.error.kind).toBe('open-contours');
  });
});

describe('offsetShapes errors', () => {
  it('reports a collapsed inward offset', () => {
    const result = offsetShapes(
      [art([square(0, 0, 4)])],
      options({ direction: 'inward', distanceMm: 3 }),
      IDS,
    );
    expect(result.kind === 'error' && result.error.kind).toBe('collapsed');
  });

  it('drops a collapsed inward half of Both and keeps the outward half', () => {
    const result = run([art([square(0, 0, 4)])], { direction: 'both', distanceMm: 3 });
    expect(result.outward).not.toBeNull();
    expect(result.inward).toBeNull();
  });

  it('refuses a zero, negative or non-finite distance', () => {
    for (const distanceMm of [0, -1, Number.NaN]) {
      const result = offsetShapes([art([square(0, 0, 10)])], options({ distanceMm }), IDS);
      expect(result.kind === 'error' && result.error.kind).toBe('bad-distance');
    }
  });

  it('needs at least one object', () => {
    const result = offsetShapes([], options({}), IDS);
    expect(result.kind === 'error' && result.error.kind).toBe('too-few-objects');
  });
});
