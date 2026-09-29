// Entities stored in an Object Coordinate System whose extrusion is (0,0,-1)
// import at their world position. Expected world values come from ezdxf 1.4.4
// (ezdxf.path.make_path, or the INSERT's virtual entities); bounds are those
// of the imported cubic curves, which sit within 0.003 mm of the true arcs.

import { describe, expect, it } from 'vitest';
import { curveSubpathBounds, type CurveSubpath, type Vec2 } from '../../core/scene';
import { parseDxf } from './parse-dxf';

function tags(...pairs: ReadonlyArray<readonly [number, string | number]>): string {
  return pairs.map(([code, value]) => `${code}\n${value}`).join('\n');
}

function section(name: string, body: string): string {
  return [tags([0, 'SECTION'], [2, name]), body, tags([0, 'ENDSEC'])].join('\n');
}

const MINUS_Z = [
  [210, 0],
  [220, 0],
  [230, -1],
] as const;

// A LINE at the far top-left pins parse-dxf's normalization (x - minX,
// maxY - y), so imported points map straight back to world coordinates.
const ANCHOR = tags([0, 'LINE'], [62, 1], [10, -200], [20, 200], [11, -199], [21, 200]);
const TESTED_COLOR = '#0000ff'; // every entity under test uses ACI 5

function toWorld(point: Vec2): Vec2 {
  return { x: point.x - 200, y: 200 - point.y };
}

function importTested(entities: string, blocks = '') {
  const text = [
    ...(blocks === '' ? [] : [section('BLOCKS', blocks)]),
    section('ENTITIES', [ANCHOR, entities].join('\n')),
    tags([0, 'EOF']),
  ].join('\n');
  const result = parseDxf({ dxfText: text, id: 'ocs', source: 'ocs.dxf' });
  if (result.kind !== 'ok' || result.object === null) throw new Error('nothing imported');
  const path = result.object.paths.find((candidate) => candidate.color === TESTED_COLOR);
  return { result, polylines: path?.polylines ?? [], curves: path?.curves ?? [] };
}

function worldBounds(curve: CurveSubpath | undefined) {
  if (curve === undefined) throw new Error('no curve');
  const bounds = curveSubpathBounds(curve);
  // The Y flip swaps which scene edge is the world minimum.
  return {
    minX: bounds.minX - 200,
    maxX: bounds.maxX - 200,
    minY: 200 - bounds.maxY,
    maxY: 200 - bounds.minY,
  };
}

function expectPoint(actual: Vec2 | undefined, x: number, y: number): void {
  if (actual === undefined) throw new Error('no point');
  const world = toWorld(actual);
  expect(world.x).toBeCloseTo(x, 4);
  expect(world.y).toBeCloseTo(y, 4);
}

function expectBounds(
  bounds: ReturnType<typeof worldBounds>,
  expected: { minX: number; maxX: number; minY: number; maxY: number },
): void {
  expect(bounds.minX).toBeCloseTo(expected.minX, 2);
  expect(bounds.maxX).toBeCloseTo(expected.maxX, 2);
  expect(bounds.minY).toBeCloseTo(expected.minY, 2);
  expect(bounds.maxY).toBeCloseTo(expected.maxY, 2);
}

describe('DXF entities with extrusion (0,0,-1)', () => {
  it('places a CIRCLE at the mirror of its OCS centre', () => {
    const { curves } = importTested(
      tags([0, 'CIRCLE'], [62, 5], [10, -50], [20, 20], [40, 5], ...MINUS_Z),
    );
    expectBounds(worldBounds(curves[0]), { minX: 45, maxX: 55, minY: 15, maxY: 25 });
  });

  it('turns an ARC into the mirrored quadrant, from its start angle to its end angle', () => {
    const { polylines, curves } = importTested(
      tags([0, 'ARC'], [62, 5], [10, 30], [20, -10], [40, 8], ...MINUS_Z, [50, 10], [51, 100]),
    );
    const points = polylines[0]?.points ?? [];
    expectPoint(points[0], -37.878462, -8.610815);
    expectPoint(points.at(-1), -28.610815, -2.121538);
    expectBounds(worldBounds(curves[0]), {
      minX: -37.878462,
      maxX: -28.610815,
      minY: -8.610815,
      maxY: -2,
    });
  });

  it('mirrors a closed LWPOLYLINE with its bulge still bulging outward', () => {
    const { polylines, curves } = importTested(
      tags(
        [0, 'LWPOLYLINE'],
        [62, 5],
        [90, 4],
        [70, 1],
        [10, 10],
        [20, 0],
        [10, 20],
        [20, 0],
        [42, 0.5],
        [10, 20],
        [20, 10],
        [10, 10],
        [20, 10],
        ...MINUS_Z,
      ),
    );
    expect(polylines[0]?.closed).toBe(true);
    expectBounds(worldBounds(curves[0]), { minX: -22.5, maxX: -10, minY: 0, maxY: 10 });
  });

  it('mirrors a 2D POLYLINE through its VERTEX bulges', () => {
    const vertex = (x: number, y: number, bulge = 0) =>
      tags([0, 'VERTEX'], [10, x], [20, y], [42, bulge]);
    const { polylines, curves } = importTested(
      [
        tags([0, 'POLYLINE'], [62, 5], [66, 1], [70, 0], ...MINUS_Z),
        vertex(0, 30, -0.4),
        vertex(15, 30),
        vertex(15, 25),
        tags([0, 'SEQEND']),
      ].join('\n'),
    );
    const points = polylines[0]?.points ?? [];
    expectPoint(points[0], 0, 30);
    expectPoint(points.at(-1), -15, 25);
    expectBounds(worldBounds(curves[0]), { minX: -15, maxX: 0, minY: 25, maxY: 33 });
  });

  it('leaves a 3D POLYLINE in world coordinates, since it has no OCS', () => {
    const { polylines } = importTested(
      [
        tags([0, 'POLYLINE'], [62, 5], [66, 1], [70, 8], ...MINUS_Z),
        tags([0, 'VERTEX'], [10, 5], [20, 5], [70, 32]),
        tags([0, 'VERTEX'], [10, 15], [20, 5], [70, 32]),
        tags([0, 'SEQEND']),
      ].join('\n'),
    );
    expectPoint(polylines[0]?.points[0], 5, 5);
    expectPoint(polylines[0]?.points[1], 15, 5);
  });

  it('runs an ELLIPSE (world centre and axis) the other way round its centre', () => {
    const { polylines, curves } = importTested(
      tags(
        [0, 'ELLIPSE'],
        [62, 5],
        [10, 40],
        [20, -30],
        [11, 6],
        [21, 3],
        ...MINUS_Z,
        [40, 0.4],
        [41, 0.3],
        [42, 2.5],
      ),
    );
    const points = polylines[0]?.points ?? [];
    expectPoint(points[0], 46.086643, -27.843239);
    expectPoint(points.at(-1), 35.911305, -33.839764);
    const bounds = worldBounds(curves[0]);
    expect(bounds.minX).toBeCloseTo(35.911305, 2);
    expect(bounds.maxX).toBeCloseTo(46.086643, 2);
  });

  it('places an INSERT through its mirrored OCS, rotation and scale included', () => {
    const blocks = [
      tags([0, 'BLOCK'], [2, 'PART'], [10, 1], [20, 2]),
      tags(
        [0, 'LWPOLYLINE'],
        [62, 5],
        [90, 3],
        [70, 0],
        [10, 1],
        [20, 2],
        [10, 11],
        [20, 2],
        [42, 1],
        [10, 11],
        [20, 8],
      ),
      tags([0, 'ENDBLK']),
    ].join('\n');
    const { polylines, curves } = importTested(
      tags([0, 'INSERT'], [2, 'PART'], [10, 20], [20, 50], [41, 2], [42, 1], [50, 30], ...MINUS_Z),
      blocks,
    );
    const points = polylines[0]?.points ?? [];
    expectPoint(points[0], -20, 50);
    expectPoint(points.at(-1), -34.320508, 65.196152);
    expectBounds(worldBounds(curves[0]), {
      minX: -41.228835,
      maxX: -20,
      minY: 50,
      maxY: 66.566703,
    });
  });

  it('reads float noise in the extrusion as exactly -Z', () => {
    const { curves } = importTested(
      tags([0, 'CIRCLE'], [62, 5], [10, -50], [20, 20], [40, 5], [210, 1e-9], [220, 0], [230, -1]),
    );
    expectBounds(worldBounds(curves[0]), { minX: 45, maxX: 55, minY: 15, maxY: 25 });
  });
});

describe('DXF entities on a plane tilted out of XY', () => {
  it('skips a tilted CIRCLE, counts it and says why instead of projecting it', () => {
    const { result, polylines } = importTested(
      tags([0, 'CIRCLE'], [62, 5], [10, 0], [20, 0], [40, 5], [210, 0], [220, 1], [230, 0]),
    );
    expect(polylines).toHaveLength(0);
    expect(result.skippedSummary).toBe('1 CIRCLE');
    expect(result.notes).toEqual([expect.stringMatching(/^CIRCLE skipped: .*tilted/)]);
  });

  it('skips a tilted INSERT with a note naming its block', () => {
    const blocks = [
      tags([0, 'BLOCK'], [2, 'PART'], [10, 0], [20, 0]),
      tags([0, 'LINE'], [62, 5], [10, 0], [20, 0], [11, 10], [21, 0]),
      tags([0, 'ENDBLK']),
    ].join('\n');
    const { result, polylines } = importTested(
      tags([0, 'INSERT'], [2, 'PART'], [10, 0], [20, 0], [210, 1], [220, 0], [230, 0]),
      blocks,
    );
    expect(polylines).toHaveLength(0);
    expect(result.skippedSummary).toBe('1 INSERT');
    expect(result.notes).toEqual([expect.stringMatching(/^INSERT "PART" skipped: .*tilted/)]);
  });
});
