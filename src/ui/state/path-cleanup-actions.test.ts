// Store behaviour of the LightBurn gap batch 5 path clean-up tools (ADR-480):
// Delete Duplicates, Close Path and Reverse Direction.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type CncTabAnchor,
  type CurveSubpath,
  type ImportedSvg,
  type Layer,
  type Polyline,
  type Project,
  type Scene,
  type SceneObject,
  type TextObject,
} from '../../core/scene';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { useToastStore } from './toast-store';
import { cncTabAnchorPosition } from '../../core/cnc/cnc-tab-anchors';

type Point = readonly [number, number];

function poly(points: ReadonlyArray<Point>, closed: boolean): Polyline {
  return { closed, points: points.map(([x, y]) => ({ x, y })) };
}

function rect(width: number, height: number): Polyline {
  return poly(
    [
      [0, 0],
      [width, 0],
      [width, height],
      [0, height],
    ],
    true,
  );
}

// Open, three points, ends 10 mm apart.
const OPEN_TRIANGLE = poly(
  [
    [0, 0],
    [10, 0],
    [6, 8],
  ],
  false,
);

function art(
  id: string,
  polylines: ReadonlyArray<Polyline>,
  patch: Partial<ImportedSvg> = {},
): ImportedSvg {
  const xs = polylines.flatMap((polyline) => polyline.points.map((point) => point.x));
  const ys = polylines.flatMap((polyline) => polyline.points.map((point) => point.y));
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    },
    transform: IDENTITY_TRANSFORM,
    operationIds: ['cut'],
    paths: [{ color: '#000000', polylines }],
    ...patch,
  };
}

function box(
  id: string,
  x: number,
  y: number,
  width: number,
  height = width,
  patch: Partial<ImportedSvg> = {},
): ImportedSvg {
  return art(id, [rect(width, height)], { transform: { ...IDENTITY_TRANSFORM, x, y }, ...patch });
}

function textWithOpenPath(id: string): TextObject {
  return {
    kind: 'text',
    id,
    fontKey: 'roboto-regular',
    content: 'V',
    sizeMm: 10,
    alignment: 'left',
    lineHeight: 1.2,
    letterSpacing: 0,
    color: '#000000',
    operationIds: ['cut'],
    transform: IDENTITY_TRANSFORM,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 8 },
    paths: [{ color: '#000000', polylines: [OPEN_TRIANGLE] }],
  };
}

function layer(id: string, patch: Partial<Layer> = {}): Layer {
  return { ...createLayer({ id, name: id, color: '#000000' }), ...patch };
}

function load(
  objects: ReadonlyArray<SceneObject>,
  selected: ReadonlyArray<string> = [],
  layers: ReadonlyArray<Layer> = [layer('cut')],
  scene: Partial<Scene> = {},
): void {
  useStore.setState({
    project: { ...createProject(), scene: { objects, layers, groups: [], ...scene } },
    selectedObjectId: selected[0] ?? null,
    additionalSelectedIds: new Set(selected.slice(1)),
    dirty: false,
  });
}

function project(): Project {
  return useStore.getState().project;
}

function objectIds(): ReadonlyArray<string> {
  return project().scene.objects.map((object) => object.id);
}

function objectById(id: string): SceneObject {
  const object = project().scene.objects.find((entry) => entry.id === id);
  if (object === undefined) throw new Error(`object ${id} missing`);
  return object;
}

function polylinesOf(id: string): ReadonlyArray<Polyline> {
  const object = objectById(id);
  return 'paths' in object ? object.paths.flatMap((path) => path.polylines) : [];
}

function select(...ids: ReadonlyArray<string>): void {
  useStore.setState({
    selectedObjectId: ids[0] ?? null,
    additionalSelectedIds: new Set(ids.slice(1)),
  });
}

function undoCount(): number {
  return useStore.getState().undoStack.length;
}

function lastToast(): { readonly message: string; readonly variant: string } | undefined {
  const toast = useToastStore.getState().toasts.at(-1);
  return toast === undefined ? undefined : { message: toast.message, variant: toast.variant };
}

beforeEach(() => {
  resetStore();
  useToastStore.setState({ toasts: [] });
});

describe('Delete Duplicates', () => {
  const layers = [layer('cut'), layer('score', { color: '#0000ff' })];

  it('deletes the later copy on the same operation and keeps a copy on another operation', () => {
    load(
      [
        box('a', 5, 5, 10),
        box('b', 5, 5, 10),
        box('scored', 5, 5, 10, 10, { operationIds: ['score'] }),
      ],
      ['b'],
      layers,
    );
    const before = project();

    useStore.getState().deleteDuplicates();

    expect(objectIds()).toEqual(['a', 'scored']);
    expect(useStore.getState().selectedObjectId).toBeNull();
    expect(useStore.getState().undoStack).toEqual([before]);
    expect(lastToast()?.message).toBe('Deleted 1 duplicate object.');
  });

  it('keeps the locked copy and deletes the unlocked one', () => {
    load([box('a', 5, 5, 10), box('b', 5, 5, 10, 10, { locked: true })]);

    useStore.getState().deleteDuplicates();

    expect(objectIds()).toEqual(['b']);
  });

  it('adds no undo step when nothing is drawn twice', () => {
    load([box('a', 0, 0, 10), box('b', 20, 0, 10)]);
    const before = project();

    useStore.getState().deleteDuplicates();

    expect(project()).toBe(before);
    expect(undoCount()).toBe(0);
    expect(lastToast()?.message).toBe(
      'No duplicates: nothing is drawn twice in the same place on the same operation.',
    );
  });
});

describe('Close Path', () => {
  it('closes an open path and its curve in one undo step and reports the widest gap', () => {
    const curve: CurveSubpath = {
      start: { x: 0, y: 0 },
      segments: [
        { kind: 'line', to: { x: 10, y: 0 } },
        { kind: 'line', to: { x: 6, y: 8 } },
      ],
      closed: false,
    };
    const open = art('open', [OPEN_TRIANGLE], {
      transform: { ...IDENTITY_TRANSFORM, scaleX: 2, scaleY: 2 },
      paths: [{ color: '#000000', polylines: [OPEN_TRIANGLE], curves: [curve] }],
    });
    load([open], ['open']);

    useStore.getState().closeSelectedPaths();

    const path = (objectById('open') as ImportedSvg).paths[0];
    expect(path?.polylines).toHaveLength(1);
    expect(path?.polylines[0]?.closed).toBe(true);
    expect(path?.polylines[0]?.points.slice(0, 3)).toEqual(OPEN_TRIANGLE.points);
    expect(path?.curves).toEqual([
      {
        ...curve,
        closed: true,
        segments: [...curve.segments, { kind: 'line', to: { x: 0, y: 0 } }],
      },
    ]);
    expect(undoCount()).toBe(1);
    expect(lastToast()?.message).toBe('Closed 1 path. The widest gap closed was 20 mm.');
  });

  it('leaves text alone and says so', () => {
    load([textWithOpenPath('label'), art('open', [OPEN_TRIANGLE])], ['label', 'open']);

    useStore.getState().closeSelectedPaths();

    expect(polylinesOf('label')).toEqual([OPEN_TRIANGLE]);
    expect(polylinesOf('open')[0]?.closed).toBe(true);
    expect(lastToast()?.message).toBe(
      'Closed 1 path. The widest gap closed was 10 mm. Text and drawn shapes keep their own paths; convert them to paths first.',
    );
  });

  it('adds no undo step when nothing selected is open', () => {
    load([box('closed', 0, 0, 10), textWithOpenPath('label')], ['closed']);
    const before = project();

    useStore.getState().closeSelectedPaths();
    expect(lastToast()?.message).toBe('The selection has no open paths to close.');

    select('label');
    useStore.getState().closeSelectedPaths();
    expect(lastToast()?.message).toBe(
      'The selection has no open paths to close. Text and drawn shapes keep their own paths; convert them to paths first.',
    );
    expect(project()).toBe(before);
    expect(undoCount()).toBe(0);
  });
});

describe('Reverse Direction', () => {
  it('keeps physical tabs on skipped paths while reversing the other paths', () => {
    const curve: CurveSubpath = {
      start: { x: 0, y: 0 },
      closed: true,
      segments: [
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
        { x: 0, y: 0 },
      ].map((to) => ({ kind: 'line', to })),
    };
    const skipped = { color: '#000000', polylines: [rect(10, 10)], curves: [curve, curve] };
    const edited = { color: '#000000', polylines: [rect(20, 20)] };
    const anchors: CncTabAnchor[] = [0, 1].map((pathIndex) => ({
      layerColor: '#000000',
      pathIndex,
      polylineIndex: 0,
      pathT: 0.125,
    }));
    const before = art('mixed', [rect(10, 10)], {
      paths: [skipped, edited],
      cncTabAnchors: anchors,
    });
    load([before], ['mixed']);
    const positions = anchors.map((entry) => cncTabAnchorPosition(before, entry));
    expect(positions.every((point) => point !== null)).toBe(true);
    useStore.getState().reverseSelectedPaths();
    const after = objectById('mixed') as ImportedSvg;
    expect(after.paths[0]).toBe(skipped);
    expect(after.cncTabAnchors?.map((entry) => entry.pathT)).toEqual([0.125, 0.875]);
    expect(after.cncTabAnchors?.map((entry) => cncTabAnchorPosition(after, entry))).toEqual(
      positions,
    );
  });

  const EITHER_END_NOTE =
    ' Open paths can still be cut from either end: set Path direction to Preserve direction in the Cut Planner to keep it.';

  function anchor(pathT: number): CncTabAnchor {
    return { layerColor: '#000000', pathIndex: 0, polylineIndex: 1, pathT };
  }

  function setOptimization(patch: Partial<Project['optimization']>): void {
    useStore.setState((state) => ({
      project: { ...state.project, optimization: { ...state.project.optimization, ...patch } },
    }));
  }

  it('swaps the ends of an open path, keeps a closed path start and moves CNC tabs', () => {
    load(
      [art('mixed', [OPEN_TRIANGLE, rect(10, 10)], { cncTabAnchors: [anchor(0.25), anchor(0)] })],
      ['mixed'],
    );

    useStore.getState().reverseSelectedPaths();

    const [open, closed] = polylinesOf('mixed');
    expect(open?.points).toEqual([
      { x: 6, y: 8 },
      { x: 10, y: 0 },
      { x: 0, y: 0 },
    ]);
    expect(closed?.points).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 0 },
    ]);
    expect(objectById('mixed').cncTabAnchors?.map((entry) => entry.pathT)).toEqual([0.75, 0]);
    expect(undoCount()).toBe(1);
    expect(lastToast()?.message).toBe(`Reversed 2 paths.${EITHER_END_NOTE}`);
  });

  it.each([
    ['preserve', 'nearest-neighbor'],
    ['allow-reverse', 'source-order'],
  ] as const)(
    'leaves out the either-end note with path direction %s and travel %s',
    (pathDirection, travelPolicy) => {
      load([art('open', [OPEN_TRIANGLE])], ['open']);
      setOptimization({ pathDirection, travelPolicy });

      useStore.getState().reverseSelectedPaths();

      expect(lastToast()?.message).toBe('Reversed 1 path.');
    },
  );

  it('leaves out the either-end note when only closed paths were reversed', () => {
    load([box('closed', 0, 0, 10)], ['closed']);

    useStore.getState().reverseSelectedPaths();

    expect(lastToast()?.message).toBe('Reversed 1 path.');
  });

  it('adds no undo step when nothing selected can be reversed', () => {
    load([textWithOpenPath('label')], ['label']);
    const before = project();

    useStore.getState().reverseSelectedPaths();

    expect(project()).toBe(before);
    expect(undoCount()).toBe(0);
    expect(lastToast()?.message).toBe(
      'Nothing to reverse: select imported, traced or drawn-line artwork. Text and drawn shapes keep their own direction.',
    );
  });
});
