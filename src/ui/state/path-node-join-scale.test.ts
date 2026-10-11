import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyTransform,
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type CurveSubpath,
  type ImportedSvg,
  type Transform,
} from '../../core/scene';
import { resetStore } from './test-helpers';
import { useStore } from './store';
import { deserializeProject, serializeProject } from '../../io/project';

const p = (x: number, y: number) => ({ x: x / 1e9, y: y / 1e9 });
const first: CurveSubpath = {
  start: p(10, 10),
  segments: [{ kind: 'cubic', control1: p(12, 15), control2: p(18, 15), to: p(20, 10) }],
  closed: false,
};
const second: CurveSubpath = {
  start: p(20.5, 10),
  segments: [{ kind: 'cubic', control1: p(25, 15), control2: p(35, 15), to: p(40, 10) }],
  closed: false,
};
const transform: Transform = {
  ...IDENTITY_TRANSFORM,
  scaleX: 1e9,
  scaleY: 5e8,
  rotationDeg: 37,
  mirrorX: true,
  x: 50,
  y: 30,
};

function bake(curve: CurveSubpath): CurveSubpath {
  return {
    ...curve,
    start: applyTransform(curve.start, transform),
    segments: curve.segments.map((segment) => {
      if (segment.kind !== 'cubic') throw new Error('Expected cubic fixture');
      return {
        ...segment,
        to: applyTransform(segment.to, transform),
        control1: applyTransform(segment.control1, transform),
        control2: applyTransform(segment.control2, transform),
      };
    }),
  };
}

function load(curves: ReadonlyArray<CurveSubpath>, objectTransform = transform) {
  const object: ImportedSvg = {
    kind: 'imported-svg',
    id: 'curves',
    source: 'curves.svg',
    transform: objectTransform,
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    paths: [
      {
        color: '#000000',
        operationIds: ['line'],
        strokeWidthMm: 0.4,
        curves,
        polylines: curves.map((curve) => ({
          points: [curve.start, ...curve.segments.map((segment) => segment.to)],
          closed: curve.closed,
        })),
      },
    ],
  };
  const project = {
    ...createProject(),
    scene: {
      objects: [object],
      layers: [createLayer({ id: 'line', color: '#000000', mode: 'line' })],
      groups: [],
    },
  };
  useStore.setState({
    project,
    dirty: false,
    undoStack: [],
    redoStack: [],
    selectedObjectId: null,
    selectedPathNode: null,
    selectedPathNodes: [],
    additionalSelectedIds: new Set(),
  });
  return project;
}

function select(polylineIndex: number, pointIndex: number, additive = false) {
  useStore
    .getState()
    .selectPathNode(
      { objectId: 'curves', pathIndex: 0, polylineIndex, pointIndex, geometry: 'curve' },
      { additive },
    );
}

function currentObject(): ImportedSvg {
  const object = useStore.getState().project.scene.objects[0];
  if (object?.kind !== 'imported-svg') throw new Error('Expected imported fixture');
  return object;
}

describe('scaled Node Join through the store', () => {
  beforeEach(resetStore);

  it('preserves a supported-scale seam through save/reopen and one Undo/Redo step', () => {
    const point = (x: number, y: number) => ({ x: x / 1e5, y: y / 1e5 });
    const a: CurveSubpath = {
      start: point(10, 10),
      segments: [
        { kind: 'cubic', control1: point(12, 15), control2: point(18, 15), to: point(20, 10) },
      ],
      closed: false,
    };
    const b: CurveSubpath = {
      start: point(20.00005, 10),
      segments: [
        { kind: 'cubic', control1: point(25, 15), control2: point(35, 15), to: point(40, 10) },
      ],
      closed: false,
    };
    const before = load([a, b], { ...IDENTITY_TRANSFORM, scaleX: 1e5, scaleY: 1e5 });
    const reopenedBefore = deserializeProject(serializeProject(before));
    expect(reopenedBefore.kind).toBe('ok');
    if (reopenedBefore.kind !== 'ok') throw new Error('Supported project must reopen');
    useStore.setState({ project: reopenedBefore.project });
    select(0, 1);
    select(1, 0, true);
    expect(useStore.getState().joinSelectedCurveNodes()).toEqual({ kind: 'joined' });
    const after = useStore.getState();
    const expected = {
      start: a.start,
      segments: [a.segments[0], { kind: 'line', to: b.start }, b.segments[0]],
      closed: false,
    };
    expect(currentObject().paths[0]?.curves?.[0]).toEqual(expected);
    const reopenedAfter = deserializeProject(serializeProject(after.project));
    expect(reopenedAfter.kind).toBe('ok');
    if (reopenedAfter.kind !== 'ok') throw new Error('Joined project must reopen');
    const object = reopenedAfter.project.scene.objects[0];
    if (object?.kind !== 'imported-svg') throw new Error('Expected saved imported geometry');
    expect(object.paths[0]?.curves?.[0]).toEqual(expected);
    const joined = object.paths[0]!.curves![0]!;
    const cubic = joined.segments[2]!;
    if (cubic.kind !== 'cubic') throw new Error('Expected original cubic');
    const midpointX =
      ((joined.segments[1]!.to.x + 3 * cubic.control1.x + 3 * cubic.control2.x + cubic.to.x) *
        1e5) /
      8;
    expect(midpointX).toBeCloseTo(30.00000625, 10);
    expect(after.undoStack).toHaveLength(1);
    after.undo();
    expect(useStore.getState().project).toEqual(reopenedBefore.project);
    expect(useStore.getState().undoStack).toHaveLength(0);
    useStore.getState().redo();
    expect(useStore.getState().project).toEqual(after.project);
    expect(useStore.getState().undoStack).toHaveLength(1);
  });

  it.each([false, true])(
    'preserves canonical seams, compatibility and one history step, baked=%s',
    (baked) => {
      const curves = baked ? [bake(first), bake(second)] : [first, second];
      const objectTransform = baked ? IDENTITY_TRANSFORM : transform;
      const before = load(curves, objectTransform);
      select(0, 1);
      select(1, 0, true);
      expect(useStore.getState().joinSelectedCurveNodes()).toEqual({ kind: 'joined' });
      const after = useStore.getState();
      const object = currentObject();
      const path = object.paths[0]!;
      expect(object.transform).toEqual(objectTransform);
      expect(path.curves).toEqual([
        {
          start: curves[0]!.start,
          segments: [
            ...curves[0]!.segments,
            { kind: 'line', to: curves[1]!.start },
            ...curves[1]!.segments,
          ],
          closed: false,
        },
      ]);
      expect(path.polylines).toHaveLength(1);
      const points = path.polylines[0]!.points;
      const seam = points.findIndex(
        (point) =>
          point.x === curves[0]!.segments[0]!.to.x && point.y === curves[0]!.segments[0]!.to.y,
      );
      expect(seam).toBeGreaterThanOrEqual(0);
      expect(points[seam + 1]).toEqual(curves[1]!.start);
      expect(path.operationIds).toEqual(['line']);
      expect(path.strokeWidthMm).toBe(0.4);
      expect(after.selectedPathNodes).toEqual([]);
      expect(after.undoStack).toHaveLength(1);
      after.undo();
      expect(useStore.getState().project).toEqual(before);
      expect(useStore.getState().undoStack).toHaveLength(0);
      useStore.getState().redo();
      expect(useStore.getState().project).toEqual(after.project);
      expect(useStore.getState().undoStack).toHaveLength(1);
    },
  );

  it('closes one scaled curve with a distinct canonical bridge and reversible history', () => {
    const segment = first.segments[0]!;
    const curve = { ...first, segments: [{ ...segment, to: p(10.5, 10) }] };
    const before = load([curve]);
    select(0, 0);
    select(0, 1, true);
    expect(useStore.getState().joinSelectedCurveNodes()).toEqual({ kind: 'closed' });
    const after = useStore.getState();
    expect(currentObject().paths[0]?.curves?.[0]).toEqual({
      ...curve,
      closed: true,
      segments: [...curve.segments, { kind: 'line', to: curve.start }],
    });
    expect(currentObject().paths[0]?.polylines[0]?.closed).toBe(true);
    expect(after.undoStack).toHaveLength(1);
    after.undo();
    expect(useStore.getState().project).toEqual(before);
    useStore.getState().redo();
    expect(useStore.getState().project).toEqual(after.project);
  });

  it.each(['closed', 'non-finite-control'] as const)(
    'rejects %s atomically without an Undo step',
    (invalid) => {
      const segment = second.segments[0]!;
      if (segment.kind !== 'cubic') throw new Error('Expected cubic fixture');
      const bad =
        invalid === 'closed'
          ? { ...second, closed: true }
          : { ...second, segments: [{ ...segment, control1: { x: NaN, y: 0 } }] };
      const before = load([first, bad]);
      select(0, 1);
      select(1, 0, true);
      expect(useStore.getState().selectedPathNodes).toHaveLength(2);
      expect(useStore.getState().joinSelectedCurveNodes()).toEqual({ kind: 'unchanged' });
      expect(useStore.getState().project).toBe(before);
      expect(useStore.getState().undoStack).toEqual([]);
      expect(useStore.getState().redoStack).toEqual([]);
      expect(useStore.getState().dirty).toBe(false);
    },
  );
});
