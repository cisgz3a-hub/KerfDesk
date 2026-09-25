import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLayer,
  createProject,
  curveControlPoint,
  curveNodePoint,
  IDENTITY_TRANSFORM,
  type CurveSubpath,
  type ImportedSvg,
  type Project,
  type SceneObject,
  type Transform,
  type Vec2,
} from '../../core/scene';
import { createPolyline } from '../../core/shapes';
import { useStore } from '../state';
import { materializedPolylineToSpecPoints } from '../state/path-node-edit-geometry';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { useUiStore } from '../state/ui-store';
import { handleNodeEditKey, useNodeEditKeys } from './node-edit-keys';
import { useNodeEditStore } from './node-edit-store';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  resetStore();
  useUiStore.setState({ toolMode: { kind: 'node' } });
  useNodeEditStore.setState({ pointer: null, selectedSegment: null, feedback: null });
});

describe('node editor keys over a segment', () => {
  it('I adds a node exactly under the pointer as one undo step', () => {
    const before = load([artwork('art', [line([0, 10, 20])])]);
    pointAt({ x: 4, y: 0.3 });

    expect(press('i')).toBe(true);

    expect(curveOf('art').segments.map((segment) => segment.to)).toEqual([
      { x: 4, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ]);
    expect(useStore.getState().selectedPathNode).toMatchObject({ pointIndex: 1 });
    expect(useStore.getState().undoStack).toEqual([before]);
  });

  it('M adds a node halfway along the segment', () => {
    load([artwork('art', [line([0, 10, 20])])]);
    pointAt({ x: 2, y: 0.2 });

    press('m');

    expect(curveNodePoint(curveOf('art'), 1)).toEqual({ x: 5, y: 0 });
  });

  it('D deletes the segment under the pointer, or the node', () => {
    load([artwork('art', [line([0, 10, 20, 30])])]);
    pointAt({ x: 25, y: 0.2 });
    press('d');
    expect(curveOf('art').segments.map((segment) => segment.to.x)).toEqual([10, 20]);

    pointAt({ x: 10.2, y: 0.1 });
    press('d');
    expect(curveOf('art').segments.map((segment) => segment.to.x)).toEqual([20]);
    expect(useStore.getState().undoStack).toHaveLength(2);
  });

  it('D on the last segment removes the artwork itself, undoably', () => {
    const before = load([artwork('art', [line([0, 10])])]);
    pointAt({ x: 5, y: 0.2 });

    press('d');

    expect(useStore.getState().project.scene.objects).toEqual([]);
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(before);
  });

  it('T trims back to crossing artwork and warns when nothing crosses', () => {
    const post: ImportedSvg = {
      ...artwork('post', [line([-10, 10])]),
      bounds: { minX: -10, minY: 0, maxX: 10, maxY: 0 },
      transform: { ...IDENTITY_TRANSFORM, x: 10, rotationDeg: 90 },
    };
    load([artwork('art', [line([0, 30])]), post]);
    pointAt({ x: 5, y: 0.2 });

    press('t');
    expect(curveOf('art').start.x).toBeCloseTo(10, 6);

    pointAt({ x: 20, y: 0.2 });
    press('t');
    expect(useStore.getState().undoStack).toHaveLength(1);
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({ variant: 'warning' });
  });

  it('C and S make the segment a curve and L makes it a line again', () => {
    load([artwork('art', [line([0, 10, 20])])]);
    pointAt({ x: 5, y: 0.2 });
    press('c');
    expect(curveOf('art').segments[0]?.kind).toBe('cubic');
    press('l');
    expect(curveOf('art').segments[0]?.kind).toBe('line');
    pointAt({ x: 15, y: 0.2 });
    press('s');
    expect(curveOf('art').segments[1]?.kind).toBe('cubic');
    expect(useStore.getState().undoStack).toHaveLength(3);
  });

  it('A turns the artwork so the segment under the pointer is level', () => {
    load([artwork('art', [line([0, 10])], [0, 1])]);
    pointAt({ x: 5, y: 0.6 });

    press('a');

    const object = objectOf('art');
    const from = applyAt(object, { x: 0, y: 0 });
    const to = applyAt(object, { x: 10, y: 1 });
    expect(to.y - from.y).toBeCloseTo(0, 9);
  });
});

describe('node editor keys over a node', () => {
  it('B breaks a closed outline open at the node', () => {
    load([pen('pen', true)]);
    pointAt({ x: 10.1, y: 0.1 });

    press('b');

    const curve = curveOf('pen');
    expect(curve.closed).toBe(false);
    expect(curve.start).toEqual({ x: 10, y: 0 });
    expectPenInStep('pen');
  });

  it('S toggles a node smooth and back, C makes it a corner', () => {
    load([pen('pen', true)]);
    pointAt({ x: 10.1, y: 0.1 });

    press('s');
    const smooth = curveOf('pen');
    const anchor = curveNodePoint(smooth, 1) as Vec2;
    const incoming = curveControlPoint(smooth, 1, 'incoming') as Vec2;
    const outgoing = curveControlPoint(smooth, 1, 'outgoing') as Vec2;
    const cross =
      (incoming.x - anchor.x) * (outgoing.y - anchor.y) -
      (incoming.y - anchor.y) * (outgoing.x - anchor.x);
    expect(cross).toBeCloseTo(0, 9);
    expectPenInStep('pen');

    press('s');
    press('c');
    expect(useStore.getState().undoStack).toHaveLength(2);
  });

  it('D deletes the node under the pointer', () => {
    load([artwork('art', [line([0, 10, 20])])]);
    pointAt({ x: 10.1, y: 0.1 });

    press('d');

    expect(curveOf('art').segments.map((segment) => segment.to)).toEqual([{ x: 20, y: 0 }]);
  });

  it('A lines selected nodes up on the one selected last, pointer or not', () => {
    load([artwork('art', [line([0, 10, 20], [0, 3, 1])])]);
    useStore.getState().selectPathNode(curveNode('art', 0));
    useStore.getState().selectPathNode(curveNode('art', 2), { additive: true });

    expect(press('a')).toBe(true);

    expect(curveNodePoint(curveOf('art'), 0)).toEqual({ x: 0, y: 1 });
    expect(curveNodePoint(curveOf('art'), 1)).toEqual({ x: 10, y: 3 });
  });
});

describe('node editor keys stand aside', () => {
  it('Delete removes a clicked segment and a held Delete stops there', () => {
    const project = load([artwork('art', [line([0, 10, 20])])]);
    const ref = { objectId: 'art', pathIndex: 0, polylineIndex: 0, segmentIndex: 1 };
    useNodeEditStore.getState().selectSegment(ref, project);

    expect(press('Delete')).toBe(true);
    expect(curveOf('art').segments).toHaveLength(1);
    expect(press('Delete', { repeat: true })).toBe(true);
    expect(objectOf('art')).toBeDefined();
    // A fresh press with nothing picked is the ordinary Delete again.
    expect(press('Delete')).toBe(false);
  });

  it('leaves keys alone outside the node tool, with modifiers, or while typing', () => {
    const project = load([artwork('art', [line([0, 10, 20])])]);
    pointAt({ x: 4, y: 0.3 });

    expect(press('i', { ctrlKey: true })).toBe(false);
    expect(press('i', { shiftKey: true })).toBe(false);
    const input = document.createElement('input');
    expect(handleNodeEditKey(keyOn(input, 'i'))).toBe(false);
    useUiStore.setState({ toolMode: { kind: 'select' } });
    expect(press('i')).toBe(false);
    expect(useStore.getState().project).toBe(project);
  });

  it('passes T on to the Text tool when the pointer is off the canvas', () => {
    load([artwork('art', [line([0, 10, 20])])]);
    expect(press('t')).toBe(false);
    pointAt({ x: 4, y: 0.3 });
    useStore.getState().selectObject(null);
    expect(press('t')).toBe(false);
  });

  it('swallows editing keys mid-drag and while held without editing', () => {
    const project = load([artwork('art', [line([0, 10, 20])])]);
    pointAt({ x: 4, y: 0.3 });

    expect(press('i', { repeat: true })).toBe(true);
    useStore.getState().beginInteraction();
    expect(press('i')).toBe(true);
    expect(useStore.getState().project).toBe(project);
  });

  it('keeps a handled key from reaching bubble-phase shortcuts', async () => {
    load([artwork('art', [line([0, 10, 20])])]);
    pointAt({ x: 4, y: 0.3 });
    const global = vi.fn();
    window.addEventListener('keydown', global);
    const root = await mountKeys();
    try {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 't', bubbles: true }));
      expect(global).not.toHaveBeenCalled();
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true }));
      expect(global).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('keydown', global);
      await act(async () => root.unmount());
    }
  });
});

afterEach(() => {
  document.body.innerHTML = '';
});

function KeysHost(): null {
  useNodeEditKeys(true);
  return null;
}

async function mountKeys(): Promise<Root> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<KeysHost />));
  return root;
}

function press(key: string, init: KeyboardEventInit = {}): boolean {
  return handleNodeEditKey(new KeyboardEvent('keydown', { key, ...init }));
}

function keyOn(target: HTMLElement, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key });
  Object.defineProperty(event, 'target', { value: target });
  return event;
}

function pointAt(scenePoint: Vec2): void {
  useNodeEditStore.getState().setPointer({ scenePoint, pxToMm: 0.1 });
}

function load(objects: ReadonlyArray<SceneObject>): Project {
  const project: Project = {
    ...createProject(),
    scene: {
      objects,
      layers: [createLayer({ id: '#000000', color: '#000000' })],
      groups: [],
    },
  };
  useStore.setState({ project, selectedObjectId: objects[0]?.id ?? null });
  return project;
}

function objectOf(id: string): SceneObject {
  const object = useStore.getState().project.scene.objects.find((candidate) => candidate.id === id);
  if (object === undefined) throw new Error(`missing ${id}`);
  return object;
}

function curveOf(id: string): CurveSubpath {
  const object = objectOf(id);
  const curve = 'paths' in object ? object.paths[0]?.curves?.[0] : undefined;
  if (curve === undefined) throw new Error(`missing curve on ${id}`);
  return curve;
}

function applyAt(object: SceneObject, point: Vec2): Vec2 {
  const transform: Transform = object.transform;
  const radians = (transform.rotationDeg * Math.PI) / 180;
  const x = point.x * transform.scaleX;
  const y = point.y * transform.scaleY;
  return {
    x: x * Math.cos(radians) - y * Math.sin(radians) + transform.x,
    y: x * Math.sin(radians) + y * Math.cos(radians) + transform.y,
  };
}

function curveNode(objectId: string, pointIndex: number) {
  return { objectId, pathIndex: 0, polylineIndex: 0, pointIndex, geometry: 'curve' as const };
}

function line(xs: ReadonlyArray<number>, ys: ReadonlyArray<number> = []): CurveSubpath {
  const at = (index: number): Vec2 => ({ x: xs[index] ?? 0, y: ys[index] ?? 0 });
  return {
    start: at(0),
    segments: xs.slice(1).map((_, index) => ({ kind: 'line' as const, to: at(index + 1) })),
    closed: false,
  };
}

function artwork(
  id: string,
  curves: ReadonlyArray<CurveSubpath>,
  ys: ReadonlyArray<number> = [],
): ImportedSvg {
  const shaped =
    ys.length === 0
      ? curves
      : curves.map((curve) => line([curve.start.x, ...curve.segments.map((s) => s.to.x)], ys));
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 30, maxY: 3 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#000000',
        polylines: shaped.map((curve) => ({
          points: [curve.start, ...curve.segments.map((segment) => segment.to)],
          closed: curve.closed,
        })),
        curves: shaped,
      },
    ],
  };
}

function pen(id: string, closed: boolean): SceneObject {
  return createPolyline({
    id,
    color: '#000000',
    spec: {
      closed,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
    },
  });
}

function expectPenInStep(id: string): void {
  const shape = objectOf(id);
  if (shape.kind !== 'shape' || shape.spec.kind !== 'polyline') throw new Error('not a pen');
  const polyline = shape.paths[0]?.polylines[0];
  expect(shape.spec.points).toEqual(
    materializedPolylineToSpecPoints(polyline?.points ?? [], polyline?.closed ?? false),
  );
}
