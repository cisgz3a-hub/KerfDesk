// Store behaviour of Optimize Shapes (LightBurn gap LBG-T22): one undo step,
// ids and bindings kept, text and drawn shapes converted only when they
// change, locked artwork left alone, nothing recorded when nothing changes,
// and the notice that says so.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SHAPE_OPTIMIZE_OPTIONS,
  type ShapeOptimizeOptions,
} from '../../core/geometry/shape-optimize/shape-optimize-options';
import { createLayer } from '../../core/scene/layer';
import { createProject, type Project } from '../../core/scene/project';
import {
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Polyline,
  type SceneObject,
  type TextObject,
  type Vec2,
} from '../../core/scene/scene-object';
import { createPolyline } from '../../core/shapes/create-polyline';
import { createRectangle } from '../../core/shapes/primitives/create-rectangle';
import { optimizeShapesSelection, planOptimizeShapes } from './optimize-shapes-plan';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { useToastStore } from './toast-store';

function noise(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32 - 0.5;
  };
}

// A traced-looking circle: 600 points with 0.08 mm of jitter.
function noisyCircle(cx: number, cy: number, radius: number, seed = 1): Polyline {
  const random = noise(seed);
  const points: Vec2[] = Array.from({ length: 600 }, (_, k) => {
    const angle = (2 * Math.PI * k) / 600;
    const r = radius + 0.08 * random();
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  });
  return { closed: true, points };
}

function square(size: number): Polyline {
  return {
    closed: true,
    points: [
      { x: 0, y: 0 },
      { x: size, y: 0 },
      { x: size, y: size },
      { x: 0, y: size },
    ],
  };
}

function art(id: string, polylines: ReadonlyArray<Polyline>, patch: Partial<ImportedSvg> = {}) {
  const object: ImportedSvg = {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 40, maxY: 40 },
    transform: IDENTITY_TRANSFORM,
    operationIds: ['cut'],
    paths: [{ color: '#000000', operationIds: ['cut'], polylines }],
    ...patch,
  };
  return object;
}

function text(id: string, polyline: Polyline): TextObject {
  return {
    kind: 'text',
    id,
    fontKey: 'roboto-regular',
    content: 'O',
    sizeMm: 10,
    alignment: 'left',
    lineHeight: 1.2,
    letterSpacing: 0,
    color: '#000000',
    operationIds: ['cut'],
    transform: IDENTITY_TRANSFORM,
    bounds: { minX: 0, minY: 0, maxX: 40, maxY: 40 },
    paths: [{ color: '#000000', polylines: [polyline] }],
  };
}

function load(objects: ReadonlyArray<SceneObject>, selected: ReadonlyArray<string>): void {
  useStore.setState({
    project: {
      ...createProject(),
      scene: {
        objects,
        layers: [createLayer({ id: 'cut', name: 'cut', color: '#000000' })],
        groups: [],
      },
    },
    selectedObjectId: selected[0] ?? null,
    additionalSelectedIds: new Set(selected.slice(1)),
    dirty: false,
  });
}

function project(): Project {
  return useStore.getState().project;
}

function objectById(id: string): SceneObject {
  const object = project().scene.objects.find((entry) => entry.id === id);
  if (object === undefined) throw new Error(`object ${id} missing`);
  return object;
}

function lastToast(): { message: string; variant: string } | undefined {
  const toast = useToastStore.getState().toasts.at(-1);
  return toast === undefined ? undefined : { message: toast.message, variant: toast.variant };
}

function optimize(patch: Partial<ShapeOptimizeOptions> = {}): boolean {
  return useStore
    .getState()
    .optimizeSelectedShapes({ ...DEFAULT_SHAPE_OPTIMIZE_OPTIONS, ...patch });
}

beforeEach(() => {
  resetStore();
  useToastStore.setState({ toasts: [] });
});

describe('optimizeSelectedShapes', () => {
  it('smooths and fits traced artwork as one undo step, keeping id, bindings and anchors', () => {
    const anchors = [{ layerColor: '#000000', pathIndex: 0, polylineIndex: 0, pathT: 0.25 }];
    load([art('a', [noisyCircle(20, 20, 10)], { laserTabAnchors: anchors })], ['a']);
    const before = project();

    expect(optimize()).toBe(true);

    const object = objectById('a');
    if (object.kind !== 'imported-svg') throw new Error('not imported artwork');
    const [path] = object.paths;
    if (path === undefined) throw new Error('path missing');
    const [curve] = path.curves ?? [];
    const [polyline] = path.polylines;
    expect(path.operationIds).toEqual(['cut']);
    expect(path.curves).toHaveLength(1);
    expect(curve?.closed).toBe(true);
    expect(curve?.segments.length).toBeLessThan(20);
    // The compatibility view follows the new curves.
    expect(polyline?.closed).toBe(true);
    expect(polyline?.points.length).toBeGreaterThan(20);
    expect(object.laserTabAnchors).toEqual(anchors);
    expect(object.bounds.minX).toBeCloseTo(10, 1);
    expect(useStore.getState().undoStack).toEqual([before]);
    expect(useStore.getState().dirty).toBe(true);
    expect(lastToast()?.message).toMatch(
      /^Optimized 1 object: 600 points became \d+ segments; nothing moved more than 0\.\d+ mm\.$/,
    );

    useStore.getState().undo();
    expect(project()).toBe(before);
  });

  it('converts changed text and drawn shapes to paths in the same step, and leaves unchanged ones be', () => {
    const rect = {
      ...createRectangle({
        id: 'r',
        color: '#000000',
        spec: { widthMm: 30, heightMm: 20, cornerRadiusMm: 0 },
      }),
      operationIds: ['cut'],
    };
    load([text('t', noisyCircle(20, 20, 8)), rect], ['t', 'r']);

    optimize();

    expect(objectById('t')).toMatchObject({ kind: 'imported-svg', id: 't', operationIds: ['cut'] });
    expect(objectById('r')).toBe(rect);
    expect(useStore.getState().undoStack).toHaveLength(1);
    expect(lastToast()?.message).toMatch(
      / 1 text object was converted to a path in the same step; Undo restores it\.$/,
    );
  });

  it('keeps a drawn line a drawn line with its points following the new outline', () => {
    const random = noise(5);
    const points = Array.from({ length: 300 }, (_, k) => ({
      x: k * 0.1,
      y: 5 * Math.sin(k * 0.02) + 0.05 * random(),
    }));
    const line = createPolyline({
      id: 'p',
      color: '#000000',
      spec: { points, closed: false },
      fairingMode: 'corner-preserving',
    });
    load([line], ['p']);

    optimize({ fitWith: 'lines-arcs' });

    const object = objectById('p');
    if (object.kind !== 'shape' || object.spec.kind !== 'polyline') throw new Error('not a line');
    expect(object.paths[0]?.curves?.[0]?.segments.length).toBeLessThan(40);
    expect(object.spec.points).toHaveLength(object.paths[0]?.polylines[0]?.points.length ?? -1);
    expect(object.paths[0]?.curves?.[0]?.start).toEqual(points[0]);
  });

  it('leaves locked artwork alone and says so', () => {
    const locked = art('l', [noisyCircle(20, 20, 10, 2)], { locked: true });
    load([art('a', [noisyCircle(20, 20, 10)]), locked], ['a', 'l']);

    optimize();

    expect(objectById('l')).toBe(locked);
    expect(lastToast()?.message).toMatch(/ 1 locked object was left as it is\.$/);
  });

  it('records nothing when only locked artwork is selected', () => {
    load([art('l', [noisyCircle(20, 20, 10)], { locked: true })], ['l']);
    const before = project();

    expect(optimize()).toBe(false);

    expect(project()).toBe(before);
    expect(useStore.getState().undoStack).toHaveLength(0);
    expect(lastToast()).toEqual({
      message: 'The selected artwork is locked, so it is left as it is. Unlock it to optimize it.',
      variant: 'warning',
    });
  });

  it('records nothing when the outlines are already as simple as the settings make them', () => {
    load([art('a', [square(20)])], ['a']);
    const before = project();

    expect(optimize()).toBe(false);

    expect(project()).toBe(before);
    expect(useStore.getState().undoStack).toHaveLength(0);
    expect(useStore.getState().dirty).toBe(false);
    expect(lastToast()?.message).toBe(
      'Nothing changed: these settings leave the selected outlines as they are.',
    );
  });

  it("applies the dialog's finished plan for objects it still matches", () => {
    load([art('a', [noisyCircle(20, 20, 10)])], ['a']);
    const selection = optimizeShapesSelection(project().scene, ['a']);
    const plan = planOptimizeShapes(selection.targets, DEFAULT_SHAPE_OPTIMIZE_OPTIONS);

    useStore.getState().optimizeSelectedShapes(DEFAULT_SHAPE_OPTIMIZE_OPTIONS, plan);

    const object = objectById('a');
    expect('paths' in object && object.paths).toBe(plan.objects[0]?.result.paths);
  });
});
