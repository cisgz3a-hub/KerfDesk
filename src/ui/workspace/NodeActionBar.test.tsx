import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  curveControlPoint,
  curveNodePoint,
  IDENTITY_TRANSFORM,
  type ColoredPath,
  type CurveSubpath,
  type ImportedSvg,
  type Project,
  type SceneObject,
  type Vec2,
} from '../../core/scene';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { useUiStore } from '../state/ui-store';
import { NodeActionBar } from './NodeActionBar';
import { useNodeEditStore } from './node-edit-store';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  resetStore();
  useUiStore.setState({ toolMode: { kind: 'node' } });
  useNodeEditStore.setState({ pointer: null, selectedSegment: null, feedback: null });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<NodeActionBar nodeToolButtonRef={{ current: null }} />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe('NodeActionBar for a clicked segment', () => {
  it('stays hidden until a node or segment is picked', () => {
    load([artwork('art', [line([0, 10, 20])])]);
    expect(host.querySelector('[role="toolbar"]')).toBeNull();
  });

  it('adds a node halfway along, then offers the new node its own actions', async () => {
    const before = load([artwork('art', [line([0, 10, 20])])]);
    await pickSegment(0);
    expect(toolbar()).toBe('Segment actions');
    expect(button('Line').disabled).toBe(true);

    await click('Add');

    expect(curveNodePoint(curveOf('art'), 1)).toEqual({ x: 5, y: 0 });
    expect(toolbar()).toBe('Curve node actions');
    expect(useStore.getState().undoStack).toEqual([before]);
  });

  it('turns the segment into a curve and back, keeping it picked', async () => {
    load([artwork('art', [line([0, 10, 20])])]);
    await pickSegment(1);

    await click('Curve');
    expect(curveOf('art').segments[1]?.kind).toBe('cubic');
    expect(button('Curve').disabled).toBe(true);
    await click('Line');
    expect(curveOf('art').segments[1]).toEqual({ kind: 'line', to: { x: 20, y: 0 } });
    expect(useStore.getState().undoStack).toHaveLength(2);
  });

  it('deletes the segment, and the artwork with its last one', async () => {
    load([artwork('art', [line([0, 10, 20])])]);
    await pickSegment(1);
    await click('Delete');
    expect(curveOf('art').segments).toHaveLength(1);
    expect(toolbar()).toBeNull();

    await pickSegment(0);
    await click('Delete');
    expect(useStore.getState().project.scene.objects).toEqual([]);
  });

  it('extends an end segment to the artwork ahead, but not an interior one', async () => {
    const post = { ...artwork('post', [line([30, 30], [-5, 5])]), bounds: POST_BOUNDS };
    load([artwork('art', [line([0, 10, 20, 25])]), post]);
    await pickSegment(1);
    expect(button('Extend').disabled).toBe(true);

    await pickSegment(2);
    await click('Extend');

    expect(curveOf('art').segments.at(-1)?.to).toEqual({ x: 30, y: 0 });
    expect(useStore.getState().undoStack).toHaveLength(1);
  });

  it('warns when there is nothing to trim back to', async () => {
    load([artwork('art', [line([0, 10, 20])])]);
    await pickSegment(0);

    await click('Trim');

    expect(useStore.getState().undoStack).toEqual([]);
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({ variant: 'warning' });
  });
});

describe('NodeActionBar for selected nodes', () => {
  it('breaks an open path at an interior node', async () => {
    load([artwork('art', [line([0, 10, 20])])]);
    await selectNode(curveNode('art', 1));
    await click('Break');

    const object = objectOf('art');
    const curves = 'paths' in object ? object.paths[0]?.curves : undefined;
    expect(curves).toHaveLength(2);
    await selectNode(curveNode('art', 0));
    expect(button('Break').disabled).toBe(true);
  });

  it('extends from an open end node only', async () => {
    const post = {
      ...artwork('post', [line([-8, -8], [-5, 5])]),
      bounds: { ...POST_BOUNDS, minX: -8, maxX: -8 },
    };
    load([artwork('art', [line([0, 10, 20])]), post]);
    await selectNode(curveNode('art', 1));
    expect(button('Extend').disabled).toBe(true);
    await selectNode(curveNode('art', 0));

    await click('Extend');

    expect(curveOf('art').start).toEqual({ x: -8, y: 0 });
  });

  it('lines up two selected nodes with Align', async () => {
    load([artwork('art', [line([0, 10, 20], [0, 3, 1])])]);
    await selectNode(curveNode('art', 0));
    expect(host.querySelector('button[aria-label="Align"]')).toBeNull();
    await selectNode(curveNode('art', 2), true);

    await click('Align');

    expect(curveNodePoint(curveOf('art'), 0)).toEqual({ x: 0, y: 1 });
  });

  it('smooths a node of artwork that has no curves yet', async () => {
    const legacy: ColoredPath = {
      color: '#000000',
      polylines: [
        {
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
          ],
          closed: false,
        },
      ],
    };
    load([{ ...artwork('art', []), paths: [legacy] }]);
    await selectNode({ objectId: 'art', pathIndex: 0, polylineIndex: 0, pointIndex: 1 });

    await click('Smooth');

    const curve = curveOf('art');
    const anchor = curveNodePoint(curve, 1) as Vec2;
    const incoming = curveControlPoint(curve, 1, 'incoming') as Vec2;
    const outgoing = curveControlPoint(curve, 1, 'outgoing') as Vec2;
    const cross =
      (incoming.x - anchor.x) * (outgoing.y - anchor.y) -
      (incoming.y - anchor.y) * (outgoing.x - anchor.x);
    expect(cross).toBeCloseTo(0, 9);
    expect(button('Start').disabled).toBe(true);
  });
});

const POST_BOUNDS = { minX: 30, minY: -5, maxX: 30, maxY: 5 };

function toolbar(): string | null {
  return host.querySelector('[role="toolbar"]')?.getAttribute('aria-label') ?? null;
}

function button(label: string): HTMLButtonElement {
  const found = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (found === null) throw new Error(`missing ${label}`);
  return found;
}

async function click(label: string): Promise<void> {
  await act(async () => button(label).click());
}

async function pickSegment(segmentIndex: number): Promise<void> {
  const ref = { objectId: 'art', pathIndex: 0, polylineIndex: 0, segmentIndex };
  await act(async () =>
    useNodeEditStore.getState().selectSegment(ref, useStore.getState().project, 0.5),
  );
}

async function selectNode(
  ref: Parameters<ReturnType<typeof useStore.getState>['selectPathNode']>[0],
  additive = false,
): Promise<void> {
  await act(async () => useStore.getState().selectPathNode(ref, { additive }));
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
  act(() => useStore.setState({ project, selectedObjectId: objects[0]?.id ?? null }));
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

function artwork(id: string, curves: ReadonlyArray<CurveSubpath>): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#000000',
        polylines: curves.map((curve) => ({
          points: [curve.start, ...curve.segments.map((segment) => segment.to)],
          closed: curve.closed,
        })),
        curves,
      },
    ],
  };
}
