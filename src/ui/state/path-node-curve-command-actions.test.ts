import { beforeEach, describe, expect, it } from 'vitest';
import { deserializeProject, serializeProject } from '../../io/project';
import {
  createLayer,
  createProject,
  curveNodeCount,
  IDENTITY_TRANSFORM,
  type ColoredPath,
  type CurveSubpath,
  type ImportedSvg,
  type Project,
} from '../../core/scene';
import { createPolyline } from '../../core/shapes';
import { resetStore } from './test-helpers';
import { useStore } from './store';
import { useToastStore } from './toast-store';

describe('curve-node Join command', () => {
  beforeEach(() => {
    resetStore();
    clearToasts();
  });

  it('closes one imported open subpath in place, announces success, and undoes exactly once', () => {
    loadImported([[lineCurve(0, 8)]]);
    selectAnchor({ pathIndex: 0, polylineIndex: 0, pointIndex: 0 });
    selectAnchor({ pathIndex: 0, polylineIndex: 0, pointIndex: 1 }, true);

    const outcome = useStore.getState().joinSelectedCurveNodes();
    const after = useStore.getState();
    const curve = importedObject(after.project).paths[0]?.curves?.[0];

    expect(outcome).toEqual({ kind: 'closed' });
    expect(curve?.closed).toBe(true);
    expect(curve?.segments.at(-1)).toEqual({ kind: 'line', to: { x: 0, y: 0 } });
    expect(after.undoStack).toHaveLength(1);
    expect(after.dirty).toBe(true);
    expect(after.selectedPathNodes).toEqual([]);
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
      variant: 'success',
      message: 'Closed the selected open curve.',
    });

    after.undo();
    expect(importedObject(useStore.getState().project).paths[0]?.curves?.[0]).toEqual(
      lineCurve(0, 8),
    );
  });

  it('closes then breaks a polyline shape with exact history and save/reopen synchronization', () => {
    const shape = createPolyline({
      id: 'shape',
      color: '#000000',
      spec: {
        points: [
          { x: 0, y: 0 },
          { x: 6, y: 0 },
          { x: 8, y: 4 },
        ],
        closed: false,
      },
    });
    loadProject({
      ...createProject(),
      scene: { objects: [shape], layers: [lineLayer()], groups: [] },
    });
    const curve = shape.paths[0]?.curves?.[0];
    if (curve === undefined) throw new Error('Expected polyline shape curve.');
    selectAnchor({ objectId: 'shape', pathIndex: 0, polylineIndex: 0, pointIndex: 0 });
    selectAnchor(
      {
        objectId: 'shape',
        pathIndex: 0,
        polylineIndex: 0,
        pointIndex: curveNodeCount(curve) - 1,
      },
      true,
    );

    expect(useStore.getState().joinSelectedCurveNodes()).toEqual({ kind: 'closed' });
    const closed = useStore.getState().project.scene.objects[0];
    assertClosedPolylineShape(closed);

    selectAnchor({ objectId: 'shape', pathIndex: 0, polylineIndex: 0, pointIndex: 0 });
    useStore.getState().breakSelectedCurve();
    const afterBreak = useStore.getState();
    assertOpenPolylineShape(afterBreak.project.scene.objects[0]);
    expect(afterBreak.undoStack).toHaveLength(2);

    afterBreak.undo();
    assertClosedPolylineShape(useStore.getState().project.scene.objects[0]);
    useStore.getState().redo();
    assertOpenPolylineShape(useStore.getState().project.scene.objects[0]);

    const reopened = deserializeProject(serializeProject(useStore.getState().project));
    expect(reopened.kind).toBe('ok');
    if (reopened.kind !== 'ok') return;
    assertOpenPolylineShape(reopened.project.scene.objects[0]);
  });

  it('explains an accepted multi-subpath polyline Shape without recording split truth', () => {
    const source = createPolyline({
      id: 'shape',
      color: '#000000',
      spec: {
        points: [
          { x: 0, y: 0 },
          { x: 6, y: 0 },
        ],
        closed: false,
      },
    });
    const curves = [lineCurve(0, 6), lineCurve(20, 26)];
    const object = {
      ...source,
      paths: [{ ...source.paths[0]!, curves, polylines: curves.map(simplePolyline) }],
    };
    const project = {
      ...createProject(),
      scene: { objects: [object], layers: [lineLayer()], groups: [] },
    };
    const reopened = deserializeProject(serializeProject(project));
    expect(reopened.kind).toBe('ok');
    if (reopened.kind !== 'ok') return;
    loadProject(reopened.project);
    selectAnchor({ objectId: 'shape', pathIndex: 0, polylineIndex: 1, pointIndex: 0 });
    selectAnchor({ objectId: 'shape', pathIndex: 0, polylineIndex: 1, pointIndex: 1 }, true);
    const before = useStore.getState();

    expect(before.joinSelectedCurveNodes()).toEqual({ kind: 'unchanged' });
    const after = useStore.getState();
    expect(after.project).toBe(before.project);
    expect(after.undoStack).toEqual([]);
    expect(after.redoStack).toEqual([]);
    expect(after.dirty).toBe(false);
    expect(after.selectedPathNodes).toEqual(before.selectedPathNodes);
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
      variant: 'warning',
      message: expect.stringMatching(/one path and one subpath/i),
    });
  });

  it.each([
    {
      name: 'an interior anchor',
      setup: () => {
        loadImported([[threeNodeCurve(0), lineCurve(20, 28)]]);
        selectAnchor({ pathIndex: 0, polylineIndex: 0, pointIndex: 1 });
        selectAnchor({ pathIndex: 0, polylineIndex: 1, pointIndex: 0 }, true);
      },
      message: /Join connects open endpoints/i,
    },
    {
      name: 'a closed path',
      setup: () => {
        loadImported([[{ ...lineCurve(0, 8), closed: true }, lineCurve(20, 28)]]);
        selectAnchor({ pathIndex: 0, polylineIndex: 0, pointIndex: 0 });
        selectAnchor({ pathIndex: 0, polylineIndex: 1, pointIndex: 0 }, true);
      },
      message: /Join requires open paths/i,
    },
    {
      name: 'different colored paths',
      setup: () => {
        loadImported([[lineCurve(0, 8)], [lineCurve(20, 28)]]);
        selectAnchor({ pathIndex: 0, polylineIndex: 0, pointIndex: 1 });
        selectAnchor({ pathIndex: 1, polylineIndex: 0, pointIndex: 0 }, true);
      },
      message: /same colored path/i,
    },
  ])('keeps project and history unchanged for $name and explains why', ({ setup, message }) => {
    setup();
    const before = useStore.getState();
    const project = before.project;
    const selection = before.selectedPathNodes;

    const outcome = before.joinSelectedCurveNodes();
    const after = useStore.getState();

    expect(outcome).toEqual({ kind: 'unchanged' });
    expect(after.project).toBe(project);
    expect(after.undoStack).toEqual([]);
    expect(after.redoStack).toEqual([]);
    expect(after.dirty).toBe(false);
    expect(after.selectedPathNodes).toEqual(selection);
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({ variant: 'warning' });
    expect(useToastStore.getState().toasts.at(-1)?.message).toMatch(message);
  });

  it('defensively explains a stale cross-object selection without mutation', () => {
    const first = imported('first', [[lineCurve(0, 8)]]);
    const second = imported('second', [[lineCurve(20, 28)]]);
    const project = {
      ...createProject(),
      scene: { objects: [first, second], layers: [lineLayer()], groups: [] },
    };
    loadProject(project);
    useStore.setState({
      selectedPathNode: anchor('second', 0, 0, 0),
      selectedPathNodes: [anchor('first', 0, 0, 1), anchor('second', 0, 0, 0)],
    });

    expect(useStore.getState().joinSelectedCurveNodes()).toEqual({ kind: 'unchanged' });
    expect(useStore.getState().project).toBe(project);
    expect(useToastStore.getState().toasts.at(-1)?.message).toMatch(/same artwork/i);
  });

  it('does not widen Lock Selection into a new Join refusal', () => {
    loadImported([[lineCurve(0, 8), lineCurve(20, 28)]]);
    selectAnchor({ pathIndex: 0, polylineIndex: 0, pointIndex: 1 });
    selectAnchor({ pathIndex: 0, polylineIndex: 1, pointIndex: 0 }, true);

    useStore.getState().lockSelection();
    const locked = useStore.getState();
    expect(importedObject(locked.project).locked).toBe(true);
    expect(locked.selectedPathNodes).toHaveLength(2);

    expect(locked.joinSelectedCurveNodes()).toEqual({ kind: 'joined' });
    const after = useStore.getState();
    expect(importedObject(after.project).paths[0]?.curves).toHaveLength(1);
    expect(after.undoStack).toHaveLength(2);
  });
});

function loadImported(
  curvesByPath: ReadonlyArray<ReadonlyArray<CurveSubpath>>,
  transform = IDENTITY_TRANSFORM,
) {
  const object = imported('curve', curvesByPath, transform);
  loadProject({
    ...createProject(),
    optimization: {
      ...createProject().optimization,
      reduceTravelMoves: false,
      travelPolicy: 'source-order',
      pathDirection: 'preserve',
    },
    scene: { objects: [object], layers: [lineLayer()], groups: [] },
  });
}

function loadProject(project: Project): void {
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
}

function imported(
  id: string,
  curvesByPath: ReadonlyArray<ReadonlyArray<CurveSubpath>>,
  transform = IDENTITY_TRANSFORM,
): ImportedSvg {
  const paths: ReadonlyArray<ColoredPath> = curvesByPath.map((curves, index) => ({
    color: index === 0 ? '#000000' : '#000000',
    operationIds: ['line'],
    strokeWidthMm: 0.4,
    curves,
    polylines: curves.map(simplePolyline),
  }));
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 108, maxY: 1 },
    transform,
    paths,
  };
}

function lineLayer() {
  return createLayer({ id: 'line', color: '#000000', mode: 'line' });
}

function selectAnchor(
  ref: {
    readonly objectId?: string;
    readonly pathIndex: number;
    readonly polylineIndex: number;
    readonly pointIndex: number;
  },
  additive = false,
): void {
  useStore
    .getState()
    .selectPathNode(
      anchor(ref.objectId ?? 'curve', ref.pathIndex, ref.polylineIndex, ref.pointIndex),
      {
        additive,
      },
    );
}

function anchor(objectId: string, pathIndex: number, polylineIndex: number, pointIndex: number) {
  return { objectId, pathIndex, polylineIndex, pointIndex, geometry: 'curve' as const };
}

function importedObject(project: Project): ImportedSvg {
  const object = project.scene.objects.find((candidate) => candidate.kind === 'imported-svg');
  if (object?.kind !== 'imported-svg') throw new Error('Expected imported curve object.');
  return object;
}

function lineCurve(startX: number, endX: number): CurveSubpath {
  return {
    start: { x: startX, y: 0 },
    segments: [{ kind: 'line', to: { x: endX, y: 0 } }],
    closed: false,
  };
}

function threeNodeCurve(startX: number): CurveSubpath {
  return {
    start: { x: startX, y: 0 },
    segments: [
      { kind: 'line', to: { x: startX + 4, y: 0 } },
      { kind: 'line', to: { x: startX + 8, y: 0 } },
    ],
    closed: false,
  };
}

function simplePolyline(curve: CurveSubpath) {
  return {
    points: [curve.start, ...curve.segments.map((segment) => segment.to)],
    closed: curve.closed,
  };
}

function clearToasts(): void {
  for (const toast of useToastStore.getState().toasts) {
    useToastStore.getState().dismissToast(toast.id);
  }
}

function assertClosedPolylineShape(object: Project['scene']['objects'][number] | undefined): void {
  expect(object?.kind).toBe('shape');
  if (object?.kind !== 'shape' || object.spec.kind !== 'polyline') {
    throw new Error('Expected closed polyline shape.');
  }
  expect(object.spec.closed).toBe(true);
  expect(object.paths[0]?.curves?.[0]?.closed).toBe(true);
  expect(object.paths[0]?.polylines[0]?.closed).toBe(true);
  expect(object.spec.points.at(-1)).not.toEqual(object.spec.points[0]);
}

function assertOpenPolylineShape(object: Project['scene']['objects'][number] | undefined): void {
  expect(object?.kind).toBe('shape');
  if (object?.kind !== 'shape' || object.spec.kind !== 'polyline') {
    throw new Error('Expected open polyline shape.');
  }
  expect(object.spec.closed).toBe(false);
  expect(object.paths[0]?.curves?.[0]?.closed).toBe(false);
  expect(object.paths[0]?.polylines[0]?.closed).toBe(false);
}
