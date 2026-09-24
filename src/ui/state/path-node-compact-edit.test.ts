import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  polylineToCurveSubpath,
  type ColoredPath,
  type Polyline,
  type TracedImage,
} from '../../core/scene';
import { deserializeProject, serializeProject } from '../../io/project';
import { hitPathNode } from '../workspace/path-node-hit-test';
import { curveCommandNode } from './path-node-command-geometry';
import { resetStore } from './test-helpers';
import { useStore } from './store';

const line: Polyline = {
  closed: true,
  points: [
    { x: 0, y: 0 },
    { x: 8, y: 0 },
    { x: 8, y: 8 },
    { x: 0, y: 8 },
  ],
};

function load(polylines: ReadonlyArray<Polyline> = [line]): TracedImage {
  const object: TracedImage = {
    id: 'photo',
    kind: 'traced-image',
    source: 'photo.png',
    traceMode: 'filled-contours',
    transform: IDENTITY_TRANSFORM,
    bounds: { minX: 0, minY: 0, maxX: 8, maxY: 8 },
    paths: [{ color: '#000000', polylines }],
  };
  useStore.setState({
    project: {
      ...createProject(),
      scene: {
        objects: [object],
        layers: [createLayer({ id: 'photo-layer', color: '#000000' })],
        groups: [],
      },
    },
    selectedObjectId: object.id,
  });
  return object;
}

function currentPath(): ColoredPath {
  const object = useStore.getState().project.scene.objects[0];
  if (object?.kind !== 'traced-image' || object.paths[0] === undefined) throw new Error('No trace');
  return object.paths[0];
}

function select(x: number, y: number, additive = false): void {
  const state = useStore.getState();
  const ref = hitPathNode(state.project.scene, { x, y }, 0.01);
  expect(ref).not.toBeNull();
  state.selectPathNode(ref, { additive });
}

describe('compact trace node editing', () => {
  beforeEach(() => resetStore());

  it('materialises on an explicit curve edit with exact one-step undo, redo and nonlinear save', () => {
    const object = load();
    select(0, 0);
    expect(currentPath()).toBe(object.paths[0]);
    expect(currentPath().curves).toBeUndefined();
    const selected = useStore.getState().selectedPathNode!;
    expect(curveCommandNode(currentPath(), selected)).toEqual({
      closed: true,
      outgoingKind: 'line',
    });

    useStore.getState().convertSelectedCurveSegment('cubic');
    const edited = useStore.getState();
    expect(currentPath().curves?.[0]?.segments[0]?.kind).toBe('cubic');
    expect(edited.undoStack).toHaveLength(1);
    expect(edited.undoStack[0]?.scene.objects[0]).toBe(object);
    expect(edited.selectedPathNode).toBeNull();
    const reopened = deserializeProject(serializeProject(edited.project));
    expect(reopened.kind).toBe('ok');
    if (reopened.kind !== 'ok') throw new Error('Invalid saved edited trace');
    const saved = reopened.project.scene.objects[0] as TracedImage;
    expect(saved.paths[0]?.curves).toEqual(currentPath().curves);

    edited.undo();
    expect(useStore.getState().project.scene.objects[0]).toBe(object);
    expect(currentPath().curves).toBeUndefined();
    useStore.getState().redo();
    expect(currentPath().curves?.[0]?.segments[0]?.kind).toBe('cubic');
  });

  it('keeps ordinary point movement compact and undoable', () => {
    const object = load();
    select(8, 0);
    useStore.getState().nudgeSelectedPathNode(1, 2);
    expect(currentPath().polylines[0]?.points[1]).toEqual({ x: 9, y: 2 });
    expect(currentPath().curves).toBeUndefined();
    expect(useStore.getState().undoStack).toHaveLength(1);
    useStore.getState().undo();
    expect(useStore.getState().project.scene.objects[0]).toBe(object);
  });

  it('breaks a compact closed path at the selected node and undoes the entire edit', () => {
    const object = load();
    select(8, 0);
    useStore.getState().breakSelectedCurve();
    expect(currentPath().curves?.[0]).toMatchObject({ closed: false, start: { x: 8, y: 0 } });
    expect(useStore.getState().undoStack).toHaveLength(1);
    useStore.getState().undo();
    expect(useStore.getState().project.scene.objects[0]).toBe(object);
  });

  it('changes the compact contour start without losing any geometry and undo restores the source', () => {
    const object = load();
    select(8, 8);
    useStore.getState().setSelectedCurveStart();
    expect(currentPath().curves?.[0]).toMatchObject({ closed: true, start: { x: 8, y: 8 } });
    expect(useStore.getState().undoStack).toHaveLength(1);
    useStore.getState().undo();
    expect(useStore.getState().project.scene.objects[0]).toBe(object);
  });

  it('joins compact endpoints with the same result as canonical endpoints in one undo transaction', () => {
    const object = load([
      {
        closed: false,
        points: [
          { x: 0, y: 0 },
          { x: 4, y: 0 },
        ],
      },
      {
        closed: false,
        points: [
          { x: 5, y: 0 },
          { x: 8, y: 0 },
        ],
      },
    ]);
    select(4, 0);
    select(5, 0, true);
    expect(useStore.getState().joinSelectedCurveNodes()).toEqual({ kind: 'joined' });
    expect(currentPath().curves).toHaveLength(1);
    expect(currentPath().polylines[0]?.points).toEqual([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 5, y: 0 },
      { x: 8, y: 0 },
    ]);
    expect(useStore.getState().undoStack).toHaveLength(1);
    useStore.getState().undo();
    expect(useStore.getState().project.scene.objects[0]).toBe(object);
  });

  it('leaves compact geometry and history alone when a command cannot change it', () => {
    const object = load();
    select(8, 0);
    useStore.getState().smoothSelectedCurveNode();
    useStore.getState().cornerSelectedCurveNode();
    useStore.getState().convertSelectedCurveSegment('line');
    expect(useStore.getState().project.scene.objects[0]).toBe(object);
    expect(useStore.getState().undoStack).toHaveLength(0);
    expect(useStore.getState().selectedPathNode).not.toBeNull();
  });

  it('does not reinterpret a stale compact reference as a canonical curve reference', () => {
    const object = load();
    select(8, 0);
    const canonical = {
      ...object,
      paths: [{ ...object.paths[0]!, curves: [polylineToCurveSubpath(line)] }],
    };
    useStore.setState((state) => ({
      project: { ...state.project, scene: { ...state.project.scene, objects: [canonical] } },
    }));
    useStore.getState().convertSelectedCurveSegment('cubic');
    expect(useStore.getState().project.scene.objects[0]).toBe(canonical);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });
});
