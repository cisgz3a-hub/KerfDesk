import { describe, expect, it } from 'vitest';
import { createLayer, type ColoredPath, type Project, type Vec2 } from '../../../core/scene';
import { findPointSnap, type PointSnapQuery } from './scene-snap-query';
import { movingNodesFromRefs } from './snap-exclusion';
import type { PointSnapKind } from './snap-kinds';
import {
  line,
  pathObject,
  polylinePath,
  projectWith,
  square,
  squarePoints,
} from './snap-scene.test-support';

const ALL_KINDS: ReadonlySet<PointSnapKind> = new Set([
  'node',
  'midpoint',
  'center',
  'intersection',
]);

describe('findPointSnap candidate kinds', () => {
  it('snaps to a node of a polyline, in world coordinates', () => {
    const project = projectWith([square('sq', 100, 100)]);

    const hit = query(project, { x: 101, y: 99 }, 2);

    expect(hit).toMatchObject({ kind: 'node', objectId: 'sq' });
    expect(hit?.pointMm).toEqual({ x: 100, y: 100 });
    expect(hit?.distanceMm).toBeCloseTo(Math.SQRT2);
  });

  it('snaps to the midpoint of a straight segment, including the closing one', () => {
    const project = projectWith([square('sq', 100, 100)]);

    expect(query(project, { x: 105, y: 100.5 }, 2)).toMatchObject({
      kind: 'midpoint',
      pointMm: { x: 105, y: 100 },
    });
    // The closing edge (0,10) -> (0,0) of the closed square.
    expect(query(project, { x: 99.4, y: 105.3 }, 2)).toMatchObject({
      kind: 'midpoint',
      pointMm: { x: 100, y: 105 },
    });
  });

  it('snaps to the centre of a closed outline', () => {
    const project = projectWith([square('sq', 100, 100)]);

    expect(query(project, { x: 105.5, y: 104.2 }, 2)).toMatchObject({
      kind: 'center',
      pointMm: { x: 105, y: 105 },
    });
  });

  it('offers the true on-curve midpoint of a cubic and of an elliptical arc', () => {
    const cubic: ColoredPath = {
      color: '#000000',
      polylines: [],
      curves: [
        {
          start: { x: 0, y: 0 },
          segments: [
            {
              kind: 'cubic',
              control1: { x: 0, y: 10 },
              control2: { x: 10, y: 10 },
              to: { x: 10, y: 0 },
            },
          ],
          closed: false,
        },
      ],
    };
    const arc: ColoredPath = {
      color: '#000000',
      polylines: [],
      curves: [
        {
          start: { x: 50, y: 0 },
          segments: [
            {
              kind: 'elliptical-arc',
              radiusX: 5,
              radiusY: 5,
              rotationDeg: 0,
              largeArc: false,
              sweep: true,
              to: { x: 60, y: 0 },
            },
          ],
          closed: false,
        },
      ],
    };
    const project = projectWith([pathObject('curves', [cubic, arc])]);

    // B(0.5) of the cubic, not the chord's middle (5, 0).
    expect(query(project, { x: 5.4, y: 7.1 }, 1)).toMatchObject({
      kind: 'midpoint',
      pointMm: { x: 5, y: 7.5 },
    });
    // Half-way round the semicircle, on the arc itself.
    const onArc = query(project, { x: 55.3, y: -4.6 }, 1);
    expect(onArc?.kind).toBe('midpoint');
    expect(onArc?.pointMm.x).toBeCloseTo(55);
    expect(onArc?.pointMm.y).toBeCloseTo(-5);
  });

  it('snaps to where two objects cross, but never to where lines would meet if extended', () => {
    const project = projectWith([
      line('a', { x: 0, y: 0 }, { x: 30, y: 30 }),
      line('b', { x: 0, y: 20 }, { x: 40, y: -20 }),
      line('c', { x: 100, y: 0 }, { x: 113, y: 0 }),
      line('d', { x: 115, y: -5 }, { x: 115, y: 5 }),
    ]);

    expect(query(project, { x: 10.5, y: 10.4 }, 2)).toMatchObject({
      kind: 'intersection',
      pointMm: { x: 10, y: 10 },
    });
    // c and d would meet at (115, 0) only if c were extended.
    expect(query(project, { x: 114, y: 0.5 }, 2, new Set(['intersection']))).toBeNull();
  });

  it('snaps to a crossing inside one path, but not to the node two neighbours share', () => {
    const bowtie = pathObject('bowtie', [
      polylinePath([
        { x: 0, y: 0 },
        { x: 20, y: 20 },
        { x: 20, y: 0 },
        { x: 0, y: 20 },
      ]),
    ]);
    const project = projectWith([bowtie]);
    const onlyCrossings = new Set<PointSnapKind>(['intersection']);

    expect(query(project, { x: 10, y: 11 }, 2, onlyCrossings)).toMatchObject({
      pointMm: { x: 10, y: 10 },
    });
    expect(query(project, { x: 19.5, y: 19.5 }, 2, onlyCrossings)).toBeNull();
  });

  it('ranks by kind before distance: a node beats a nearer midpoint', () => {
    const project = projectWith([line('short', { x: 0, y: 0 }, { x: 2, y: 0 })]);

    expect(query(project, { x: 0.9, y: 0 }, 1.5)).toMatchObject({
      kind: 'node',
      pointMm: { x: 0, y: 0 },
    });
    expect(query(project, { x: 0.9, y: 0 }, 1.5, new Set(['midpoint']))).toMatchObject({
      kind: 'midpoint',
      pointMm: { x: 1, y: 0 },
    });
  });

  it('follows the object transform (rotation and scale)', () => {
    const turned = square('turned', 50, 50, { rotationDeg: 90, scaleX: 2, scaleY: 2 });
    const project = projectWith([turned]);

    // Local (10, 0) lands at (50 + 0, 50 + 20) after scale 2 and a 90° turn.
    const hit = query(project, { x: 50.6, y: 69.5 }, 1, new Set(['node']));
    expect(hit?.pointMm.x).toBeCloseTo(50);
    expect(hit?.pointMm.y).toBeCloseTo(70);
  });
});

describe('findPointSnap limits and exclusions', () => {
  it('finds nothing beyond the snap distance', () => {
    const project = projectWith([square('sq', 100, 100)]);

    expect(query(project, { x: 100, y: 97.4 }, 2.5)).toBeNull();
    expect(query(project, { x: 100, y: 97.6 }, 2.5)).toMatchObject({ kind: 'node' });
  });

  it('only offers the kinds that are switched on', () => {
    const project = projectWith([square('sq', 100, 100)]);

    expect(query(project, { x: 101, y: 99 }, 2, new Set(['center']))).toBeNull();
    expect(query(project, { x: 101, y: 99 }, 2, new Set())).toBeNull();
  });

  it('ignores locked objects', () => {
    const project = projectWith([{ ...square('sq', 100, 100), locked: true }]);

    expect(query(project, { x: 101, y: 99 }, 2)).toBeNull();
  });

  it('ignores artwork on hidden layers, path by path', () => {
    const hiddenLayer = { ...createLayer({ id: 'hidden', color: '#ff0000' }), visible: false };
    const visibleLayer = createLayer({ id: 'shown', color: '#000000' });
    const hiddenOnly = pathObject('hidden-only', [
      { ...polylinePath(squarePoints(0, 0)), color: '#ff0000' },
    ]);
    const mixed = pathObject('mixed', [
      { ...polylinePath(squarePoints(50, 0)), color: '#ff0000' },
      polylinePath(squarePoints(80, 0)),
    ]);
    const project = projectWith([hiddenOnly, mixed], [hiddenLayer, visibleLayer]);

    expect(query(project, { x: 0.5, y: 0.5 }, 2)).toBeNull();
    expect(query(project, { x: 50.5, y: 0.5 }, 2, new Set(['node']))).toBeNull();
    expect(query(project, { x: 80.5, y: 0.5 }, 2)).toMatchObject({ pointMm: { x: 80, y: 0 } });
  });

  it('never offers the objects being moved', () => {
    const project = projectWith([square('moving', 0, 0), square('other', 30, 0)]);

    expect(
      findPointSnap({
        ...baseQuery(project, { x: 0.5, y: 0.5 }, 2),
        exclusion: { objectIds: new Set(['moving']) },
      }),
    ).toBeNull();
  });

  it('keeps a dragged node, its segments and its centre out, but offers the rest of its path', () => {
    const project = projectWith([square('sq', 0, 0)]);
    const movingNodes = movingNodesFromRefs([
      { objectId: 'sq', pathIndex: 0, polylineIndex: 0, pointIndex: 0 },
    ]);
    if (movingNodes === undefined) throw new Error('expected moving nodes');
    const exclusion = { movingNodes };
    const excluding = (point: Vec2) =>
      findPointSnap({ ...baseQuery(project, point, 2), exclusion });

    expect(excluding({ x: 0.5, y: 0.5 })).toBeNull();
    // Midpoints of both edges that meet the dragged node.
    expect(excluding({ x: 5, y: 0.5 })).toBeNull();
    expect(excluding({ x: 0.5, y: 5 })).toBeNull();
    // The centre moves with the node.
    expect(excluding({ x: 5, y: 5.5 })).toBeNull();
    // A node and a midpoint the drag does not touch.
    expect(excluding({ x: 10.5, y: 0.5 })).toMatchObject({ kind: 'node' });
    expect(excluding({ x: 10.5, y: 5 })).toMatchObject({ kind: 'midpoint' });
  });

  it('answers quickly on a 200k-point trace, without scanning every point', () => {
    const trace = pathObject('trace', [polylinePath(zigzagTrace(200_000))]);
    const project = projectWith([trace]);

    const buildStart = performance.now();
    query(project, { x: 50, y: 50 }, 1);
    const buildMs = performance.now() - buildStart;

    const queryStart = performance.now();
    let found = 0;
    for (let i = 0; i < 500; i += 1) {
      if (query(project, { x: (i * 7.3) % 100, y: (i * 3.1) % 100 }, 1) !== null) found += 1;
    }
    const perQueryMs = (performance.now() - queryStart) / 500;

    expect(found).toBeGreaterThan(400);
    // Generous ceilings for a loaded CI box; locally a query is well under 1 ms.
    expect(buildMs).toBeLessThan(5000);
    expect(perQueryMs).toBeLessThan(25);
  });
});

function query(
  project: Project,
  pointMm: Vec2,
  radiusMm: number,
  kinds: ReadonlySet<PointSnapKind> = ALL_KINDS,
): ReturnType<typeof findPointSnap> {
  return findPointSnap(baseQuery(project, pointMm, radiusMm, kinds));
}

function baseQuery(
  project: Project,
  pointMm: Vec2,
  radiusMm: number,
  kinds: ReadonlySet<PointSnapKind> = ALL_KINDS,
): PointSnapQuery {
  return { project, pointMm, radiusMm, kinds };
}

// A dense scan-line trace filling 100 x 100 mm, like a photo trace.
function zigzagTrace(count: number): ReadonlyArray<Vec2> {
  const rows = Math.ceil(Math.sqrt(count));
  return Array.from({ length: count }, (_, i) => {
    const row = Math.floor(i / rows);
    const column = i % rows;
    const x = ((row % 2 === 0 ? column : rows - 1 - column) / rows) * 100;
    return { x, y: (row / rows) * 100 + (column % 2) * 0.05 };
  });
}
