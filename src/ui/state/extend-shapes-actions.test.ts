import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  flattenCurveSubpath,
  IDENTITY_TRANSFORM,
  type CurveSubpath,
  type ImportedSvg,
  type SceneObject,
  type ShapeObject,
  type TextObject,
  type Vec2,
} from '../../core/scene';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { useToastStore } from './toast-store';
import { MAX_FLATTENED_CURVE_SEGMENTS } from '../../core/scene/curve-path';

const point = (x: number, y: number): Vec2 => ({ x, y });
function line(id: string, points: readonly Vec2[], patch: Partial<ImportedSvg> = {}): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 30, maxY: 30 },
    transform: IDENTITY_TRANSFORM,
    operationIds: ['cut'],
    paths: [{ color: '#000000', polylines: [{ points, closed: false }] }],
    ...patch,
  };
}
const source = () => line('source', [point(0, 10), point(10, 10)]);
const boundary = () => line('boundary', [point(20, 0), point(20, 20)], { locked: true });
function load(objects: readonly SceneObject[]): void {
  const project = createProject();
  useStore.setState({
    project: {
      ...project,
      scene: {
        ...project.scene,
        objects,
        layers: [createLayer({ id: 'cut', name: 'Cut', color: '#000000' })],
      },
    },
    selectedObjectId: 'source',
  });
}
function current(): ImportedSvg {
  return useStore.getState().project.scene.objects[0] as ImportedSvg;
}
beforeEach(() => {
  resetStore();
  useToastStore.setState({ toasts: [] });
});

describe('Extend Shapes store action', () => {
  it('rebuilds a stale canonical cubic cache before synchronizing a placed polyline spec', () => {
    const curve: CurveSubpath = {
      start: point(100, 0),
      closed: false,
      segments: [
        { kind: 'cubic', control1: point(103, 6), control2: point(107, 0), to: point(110, 0) },
      ],
    };
    const stale = [point(0, 0), point(10, 0)];
    const shape: ShapeObject = {
      ...line('source', stale),
      kind: 'shape',
      color: '#000000',
      spec: { kind: 'polyline', points: stale, closed: false },
      transform: { ...IDENTITY_TRANSFORM, x: 5, scaleX: 2, scaleY: 3 },
      paths: [{ color: '#000000', polylines: [{ closed: false, points: stale }], curves: [curve] }],
    };
    const boundary = line('boundary', [point(245, -100), point(245, 100)]);
    load([shape, boundary]);
    const before = useStore.getState().project;
    expect(useStore.getState().extendShapeAt(point(225, 0), 0.5)).toBe(true);
    const after = useStore.getState().project.scene.objects[0];
    if (after?.kind !== 'shape' || after.spec.kind !== 'polyline')
      throw new Error('Expected polyline shape');
    const edited = after.paths[0]?.curves?.[0];
    expect(edited).toEqual({
      ...curve,
      segments: [...curve.segments, { kind: 'line', to: point(120, 0) }],
    });
    const expected = flattenCurveSubpath(edited!, { toleranceMm: 0.025 / 3 });
    if (expected.kind !== 'ok') throw new Error('Expected fixture to flatten');
    expect(after.paths[0]?.polylines[0]).toEqual(expected.polyline);
    expect(after.spec.points).toEqual(expected.polyline.points);
    expect(after.spec.points).toContainEqual(point(110, 0));
    expect(after.spec.points).not.toContainEqual(point(10, 0));
    expect(after.transform).toEqual(shape.transform);
    expect(useStore.getState().project.scene.objects[1]).toBe(boundary);
    expect(useStore.getState().undoStack).toEqual([before]);
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(before);
  });

  it('reports a bounded cache rebuild failure without changing geometry or history', () => {
    const curve: CurveSubpath = {
      start: point(0, 0),
      closed: false,
      segments: [
        ...Array.from({ length: MAX_FLATTENED_CURVE_SEGMENTS }, () => ({
          kind: 'line' as const,
          to: point(0, 0),
        })),
        { kind: 'cubic', control1: point(1, 20), control2: point(7, 10), to: point(10, 10) },
      ],
    };
    const source = line('source', [point(0, 0), point(10, 10)]);
    load([{ ...source, paths: [{ ...source.paths[0]!, curves: [curve] }] }, boundary()]);
    const before = useStore.getState();
    expect(useStore.getState().extendShapeAt(point(10, 10), 0.5)).toBe(false);
    expect(useStore.getState()).toBe(before);
    expect(useToastStore.getState().toasts.at(-1)?.message).toContain('could not be extended');
  });

  it('retains canonical extrema of an untouched curve under nonuniform scale', () => {
    const curve: CurveSubpath = {
      closed: false,
      start: point(0, 30),
      segments: [
        { kind: 'cubic', control1: point(0, 50), control2: point(10, 50), to: point(10, 30) },
      ],
    };
    // Deliberately coarse compatibility points omit the exact y = 45 maximum.
    const curvePath = {
      color: '#000000',
      curves: [curve],
      polylines: [{ closed: false, points: [curve.start, point(10, 30)] }],
    };
    const transform = { ...IDENTITY_TRANSFORM, x: 5, y: 7, scaleX: 2, scaleY: 3 };
    const original = source();
    load([
      {
        ...original,
        transform,
        paths: [...original.paths, curvePath],
        bounds: { minX: 0, minY: 10, maxX: 10, maxY: 45 },
      },
      line('boundary', [point(45, 0), point(45, 80)], { locked: true }),
    ]);
    const before = useStore.getState().project;
    expect(useStore.getState().extendShapeAt(point(25, 37), 0.5)).toBe(true);
    expect(current().bounds).toEqual({ minX: 0, minY: 10, maxX: 20, maxY: 45 });
    expect(current().transform).toBe(transform);
    expect(current().paths[1]).toBe(curvePath);
    expect(current().bounds.maxY * transform.scaleY + transform.y).toBe(142);
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(before);
  });

  it.each([undefined, 'evenodd'] as const)(
    'preserves text fill semantics (%s) when extending one of mixed open and closed contours',
    (fillRule) => {
      const closed = {
        closed: true,
        points: [point(30, 30), point(40, 30), point(40, 40), point(30, 40)],
      };
      const open = source().paths[0]!.polylines[0]!;
      const text: TextObject = {
        ...source(),
        kind: 'text',
        name: 'Mixed glyphs',
        content: '10',
        fontKey: 'single-line',
        sizeMm: 10,
        alignment: 'left',
        lineHeight: 1.2,
        letterSpacing: 0,
        color: '#000000',
        paths: [
          {
            color: '#000000',
            polylines: [open, closed],
            ...(fillRule === undefined ? {} : { fillRule }),
          },
        ],
      };
      load([text, boundary()]);
      const before = useStore.getState().project;
      expect(useStore.getState().extendShapeAt(point(10, 10), 0.5)).toBe(true);
      expect(current()).toMatchObject({ kind: 'imported-svg', name: 'Mixed glyphs' });
      expect(current().paths[0]?.fillRule).toBe(fillRule ?? 'nonzero');
      expect(current().paths[0]?.polylines[0]?.points.at(-1)).toEqual(point(20, 10));
      expect(current().paths[0]?.polylines[1]).toBe(closed);
      const edited = useStore.getState().project;
      expect(useStore.getState().undoStack).toEqual([before]);
      useStore.getState().undo();
      expect(useStore.getState().project).toBe(before);
      useStore.getState().redo();
      expect(useStore.getState().project).toBe(edited);
    },
  );
  it('preserves an assigned name when an open text stroke becomes a plain path', () => {
    const text: TextObject = {
      ...source(),
      kind: 'text',
      name: 'Serial number engraving',
      content: '1',
      fontKey: 'single-line',
      sizeMm: 10,
      alignment: 'left',
      lineHeight: 1.2,
      letterSpacing: 0,
      color: '#000000',
    };
    load([text, boundary()]);
    const before = useStore.getState().project;
    expect(useStore.getState().extendShapeAt(point(10, 10), 0.5)).toBe(true);
    expect(current()).toMatchObject({
      kind: 'imported-svg',
      id: 'source',
      name: 'Serial number engraving',
      operationIds: ['cut'],
      transform: text.transform,
    });
    expect(current().paths[0]?.polylines[0]?.points.at(-1)).toEqual(point(20, 10));
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(before);
  });
  it.each(['imported-svg', 'shape'] as const)(
    'keeps a %s cubic intact and adds a straight tangent in one Undo step',
    (kind) => {
      const curve: CurveSubpath = {
        closed: false,
        start: point(0, 0),
        segments: [
          { kind: 'cubic', control1: point(1, 20), control2: point(7, 10), to: point(10, 10) },
        ],
      };
      const flat = flattenCurveSubpath(curve, { toleranceMm: 0.025 });
      if (flat.kind !== 'ok') throw new Error('Cannot flatten test curve');
      const imported = line('source', flat.polyline.points, {
        paths: [{ color: '#000000', polylines: [flat.polyline], curves: [curve] }],
      });
      const artwork: ImportedSvg | ShapeObject =
        kind === 'imported-svg'
          ? imported
          : {
              ...imported,
              kind: 'shape',
              color: '#000000',
              spec: { kind: 'polyline', points: flat.polyline.points, closed: false },
            };
      load([artwork, boundary()]);
      const before = useStore.getState().project;
      expect(useStore.getState().extendShapeAt(point(10, 10), 0.5)).toBe(true);
      const after = useStore.getState().project.scene.objects[0];
      expect(after).toMatchObject({ kind, id: 'source', operationIds: ['cut'] });
      expect(after !== undefined && 'paths' in after && after.paths[0]?.curves?.[0]).toEqual({
        ...curve,
        segments: [...curve.segments, { kind: 'line', to: point(20, 10) }],
      });
      if (after?.kind === 'shape' && after.spec.kind === 'polyline') {
        expect(after.spec.points.at(-1)).toEqual(point(20, 10));
      }
      expect(useStore.getState().undoStack).toEqual([before]);
      useStore.getState().undo();
      expect(useStore.getState().project).toBe(before);
    },
  );
  it('extends one endpoint, preserves the boundary and metadata, and supports Undo and Redo', () => {
    const target = boundary();
    load([{ ...source(), name: 'Named outline', powerScale: 0.75 }, target]);
    const before = useStore.getState().project;
    expect(useStore.getState().extendShapeAt(point(10, 10), 0.5)).toBe(true);
    const after = useStore.getState().project;
    expect(current().paths[0]?.polylines[0]?.points.at(-1)).toEqual(point(20, 10));
    expect(current()).toMatchObject({
      id: 'source',
      name: 'Named outline',
      powerScale: 0.75,
      operationIds: ['cut'],
    });
    expect(after.scene.objects[1]).toBe(target);
    expect(useStore.getState().selectedObjectId).toBe('source');
    expect(useStore.getState().undoStack).toEqual([before]);
    expect(useStore.getState().dirty).toBe(true);
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(before);
    useStore.getState().redo();
    expect(useStore.getState().project).toBe(after);
  });

  it('leaves project, dirty flag and history intact when the endpoint has no boundary', () => {
    load([source()]);
    const before = useStore.getState().project;
    expect(useStore.getState().extendShapeAt(point(10, 10), 0.5)).toBe(false);
    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().undoStack).toEqual([]);
    expect(useStore.getState().dirty).toBe(false);
    expect(useToastStore.getState().toasts.at(-1)?.message).toContain('No boundary ahead');
  });

  it('does not edit from a line interior, a locked source, or an already touching endpoint', () => {
    for (const [object, click] of [
      [source(), point(5, 10)],
      [{ ...source(), locked: true }, point(10, 10)],
      [line('source', [point(0, 10), point(20, 10)]), point(20, 10)],
    ] as const) {
      load([object, boundary()]);
      const before = useStore.getState().project;
      expect(useStore.getState().extendShapeAt(click, 0.5)).toBe(false);
      expect(useStore.getState().project).toBe(before);
      expect(useStore.getState().undoStack).toEqual([]);
    }
  });

  it('synchronizes a drawn polyline spec and preserves its placement', () => {
    const original = source();
    const shape: ShapeObject = {
      ...original,
      kind: 'shape',
      color: '#000000',
      spec: { kind: 'polyline', points: [point(0, 10), point(10, 10)], closed: false },
      transform: { ...IDENTITY_TRANSFORM, x: 5 },
    };
    load([shape, boundary()]);
    expect(useStore.getState().extendShapeAt(point(15, 10), 0.5)).toBe(true);
    expect(current()).toMatchObject({
      kind: 'shape',
      transform: shape.transform,
      spec: { kind: 'polyline', points: [point(0, 10), point(15, 10)], closed: false },
    });
  });

  it('removes stale tabs only on the edited open contour and restores them with Undo', () => {
    const anchor = { layerColor: '#000000', pathIndex: 0, polylineIndex: 0, pathT: 0.5 };
    const other = { ...anchor, polylineIndex: 1 };
    load([
      { ...source(), cncTabAnchors: [anchor, other], laserTabAnchors: [anchor, other] },
      boundary(),
    ]);
    const before = useStore.getState().project;
    expect(useStore.getState().extendShapeAt(point(10, 10), 0.5)).toBe(true);
    expect(current().cncTabAnchors).toEqual([other]);
    expect(current().laserTabAnchors).toEqual([other]);
    expect(useToastStore.getState().toasts.at(-1)?.message).toContain('Placed tabs');
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(before);
  });
});
