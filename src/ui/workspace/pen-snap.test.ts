import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type CurveSubpath,
  type Project,
  type RasterImage,
  type SceneObject,
  type Transform,
  type Vec2,
} from '../../core/scene';
import { createPenPath, type PenNode } from '../../core/shapes/pen-path';
import { nearestJoinableEndpoint, penSnapReachMm, resolvePenSnap } from './pen-snap';
import { DEFAULT_SNAP_SETTINGS } from './snapping';

const REACH_MM = 3;
const NO_GRID = { ...DEFAULT_SNAP_SETTINGS, snapToGrid: false };

function snapAt(project: Project, point: Vec2, settings = NO_GRID) {
  return resolvePenSnap({ project, point, reachMm: REACH_MM, settings });
}

describe('resolvePenSnap (ADR-380)', () => {
  it('snaps to an existing node', () => {
    const project = projectWith(line('a', { x: 10, y: 10 }, { x: 40, y: 10 }));

    expect(snapAt(project, { x: 11, y: 12 })).toEqual({
      point: { x: 10, y: 10 },
      kind: 'endpoint',
    });
  });

  it('snaps to the midpoint of a segment', () => {
    const project = projectWith(line('a', { x: 0, y: 0 }, { x: 20, y: 0 }));

    expect(snapAt(project, { x: 10.5, y: 1 })).toEqual({
      point: { x: 10, y: 0 },
      kind: 'midpoint',
    });
  });

  it('snaps to where two lines cross', () => {
    const project = projectWith(
      line('a', { x: 0, y: 0 }, { x: 20, y: 20 }),
      line('b', { x: 0, y: 20 }, { x: 20, y: 0 }),
    );

    const snap = snapAt(project, { x: 10.8, y: 10.4 });

    expect(snap?.kind).toBe('intersection');
    expect(snap?.point.x).toBeCloseTo(10);
    expect(snap?.point.y).toBeCloseTo(10);
  });

  it('snaps to crossings between strokes of one imported drawing', () => {
    const project = projectWith(
      svg('art', [
        polyline({ x: 0, y: 0 }, { x: 20, y: 20 }),
        polyline({ x: 0, y: 20 }, { x: 20, y: 0 }),
      ]),
    );

    expect(snapAt(project, { x: 11, y: 10.5 })?.kind).toBe('intersection');
  });

  it('falls back to the nearest point on a line', () => {
    const project = projectWith(line('a', { x: 0, y: 0 }, { x: 40, y: 0 }));

    expect(snapAt(project, { x: 5, y: 0.5 })).toEqual({ point: { x: 5, y: 0 }, kind: 'on-line' });
  });

  it('prefers a node over a nearer point on the line beside it', () => {
    const project = projectWith(line('a', { x: 0, y: 0 }, { x: 40, y: 0 }));

    expect(snapAt(project, { x: 1, y: 0.2 })).toEqual({ point: { x: 0, y: 0 }, kind: 'endpoint' });
  });

  it('snaps to nodes of moved and rotated artwork where they are drawn', () => {
    const turned: Transform = { ...IDENTITY_TRANSFORM, x: 100, y: 50, rotationDeg: 90 };
    const project = projectWith({
      ...line('a', { x: 0, y: 0 }, { x: 10, y: 0 }),
      transform: turned,
    });

    const snap = snapAt(project, { x: 100.5, y: 61 });

    expect(snap?.kind).toBe('endpoint');
    expect(snap?.point.x).toBeCloseTo(100);
    expect(snap?.point.y).toBeCloseTo(60);
  });

  it('puts a curved segment midpoint half-way along its length', () => {
    const curve: CurveSubpath = {
      start: { x: 0, y: 0 },
      segments: [
        {
          kind: 'cubic',
          control1: { x: 0, y: 20 },
          control2: { x: 40, y: 20 },
          to: { x: 40, y: 0 },
        },
      ],
      closed: false,
    };
    const project = projectWith(svg('arc', [], [curve]));

    const snap = snapAt(project, { x: 20, y: 16 });

    expect(snap?.kind).toBe('midpoint');
    expect(snap?.point.x).toBeCloseTo(20, 1);
    expect(snap?.point.y).toBeCloseTo(15, 1);
  });

  it('snaps to image corners', () => {
    const project = projectWith(image('photo', { minX: 0, minY: 0, maxX: 30, maxY: 20 }));

    expect(snapAt(project, { x: 29, y: 21 })).toEqual({
      point: { x: 30, y: 20 },
      kind: 'endpoint',
    });
  });

  it('ignores artwork on hidden layers', () => {
    const project = projectWith(line('a', { x: 10, y: 10 }, { x: 40, y: 10 }));
    const hidden = {
      ...project,
      scene: {
        ...project.scene,
        layers: project.scene.layers.map((layer) => ({ ...layer, visible: false })),
      },
    };

    expect(snapAt(hidden, { x: 11, y: 11 })).toBeNull();
  });

  it('pulls toward grid lines only within the move-snap distance', () => {
    const empty = projectWith();

    expect(snapAt(empty, { x: 21, y: 38.5 }, DEFAULT_SNAP_SETTINGS)).toEqual({
      point: { x: 20, y: 40 },
      kind: 'grid',
    });
    expect(snapAt(empty, { x: 21, y: 35 }, DEFAULT_SNAP_SETTINGS)).toEqual({
      point: { x: 20, y: 35 },
      kind: 'grid',
    });
    expect(snapAt(empty, { x: 22.5, y: 35 }, DEFAULT_SNAP_SETTINGS)).toBeNull();
  });

  it('never drags a real node onto the grid', () => {
    const project = projectWith(line('a', { x: 11.5, y: 11.5 }, { x: 45, y: 45 }));

    expect(snapAt(project, { x: 10.5, y: 10.5 }, DEFAULT_SNAP_SETTINGS)).toEqual({
      point: { x: 11.5, y: 11.5 },
      kind: 'endpoint',
    });
  });

  it('stays off when snapping is switched off', () => {
    const project = projectWith(line('a', { x: 10, y: 10 }, { x: 40, y: 10 }));

    expect(
      snapAt(project, { x: 11, y: 11 }, { ...DEFAULT_SNAP_SETTINGS, enabled: false }),
    ).toBeNull();
  });

  it('reaches three times as far with Alt', () => {
    expect(penSnapReachMm(0.5, true)).toBeCloseTo(3 * penSnapReachMm(0.5, false));
  });
});

describe('nearestJoinableEndpoint (ADR-380)', () => {
  it('finds the nearest open end of a pen drawing', () => {
    const project = projectWith(line('a', { x: 10, y: 10 }, { x: 40, y: 10 }));

    expect(
      nearestJoinableEndpoint({ project, point: { x: 39, y: 11 }, reachMm: REACH_MM }),
    ).toEqual({
      objectId: 'a',
      pathIndex: 0,
      curveIndex: 0,
      end: 'end',
      point: { x: 40, y: 10 },
    });
  });

  it('skips closed paths, locked artwork and tabbed artwork', () => {
    const closed = createPenPath({
      id: 'closed',
      color: '#000000',
      nodes: corners([
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 20 },
      ]),
      closed: true,
    });
    if (closed === null) throw new Error('fixture');
    const locked = { ...line('locked', { x: 50, y: 0 }, { x: 60, y: 0 }), locked: true };
    const tabbed = {
      ...line('tabbed', { x: 80, y: 0 }, { x: 90, y: 0 }),
      cncTabAnchors: [{ layerColor: '#000000', pathIndex: 0, polylineIndex: 0, pathT: 0.5 }],
    };
    const project = projectWith(closed, locked, tabbed);

    for (const point of [
      { x: 0, y: 0 },
      { x: 60, y: 0 },
      { x: 90, y: 0 },
    ]) {
      expect(nearestJoinableEndpoint({ project, point, reachMm: REACH_MM })).toBeNull();
    }
  });

  it('never offers the end a path is being continued from', () => {
    const project = projectWith(line('a', { x: 10, y: 10 }, { x: 12, y: 10 }));
    const start = nearestJoinableEndpoint({ project, point: { x: 10, y: 10 }, reachMm: REACH_MM });
    if (start === null) throw new Error('expected the start');

    const other = nearestJoinableEndpoint({
      project,
      point: { x: 10, y: 10 },
      reachMm: REACH_MM,
      exclude: start,
    });

    expect(other?.end).toBe('end');
  });
});

function corners(points: ReadonlyArray<Vec2>): PenNode[] {
  return points.map((point) => ({ kind: 'corner', point }));
}

function line(id: string, from: Vec2, to: Vec2): SceneObject {
  const shape = createPenPath({ id, color: '#000000', nodes: corners([from, to]), closed: false });
  if (shape === null) throw new Error('fixture');
  return shape;
}

function polyline(from: Vec2, to: Vec2) {
  return { points: [from, to], closed: false };
}

// Imported artwork; with curves, the stored polylines are placeholders the
// snap never reads because the exact curves take precedence.
function svg(
  id: string,
  polylines: ReadonlyArray<ReturnType<typeof polyline>>,
  curves?: ReadonlyArray<CurveSubpath>,
): SceneObject {
  const placeholder = polyline({ x: 0, y: 0 }, { x: 0, y: 0 });
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 40, maxY: 20 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      curves === undefined
        ? { color: '#000000', polylines }
        : { color: '#000000', polylines: curves.map(() => placeholder), curves },
    ],
  };
}

function image(id: string, bounds: SceneObject['bounds']): RasterImage {
  return {
    kind: 'raster-image',
    id,
    source: `${id}.png`,
    pixelWidth: 30,
    pixelHeight: 20,
    bounds,
    transform: IDENTITY_TRANSFORM,
    color: '#000000',
    dither: 'floyd-steinberg',
    linesPerMm: 10,
  };
}

function projectWith(...objects: ReadonlyArray<SceneObject>): Project {
  const project = createProject();
  return {
    ...project,
    scene: { objects, layers: [createLayer({ id: '#000000', color: '#000000' })] },
  };
}
