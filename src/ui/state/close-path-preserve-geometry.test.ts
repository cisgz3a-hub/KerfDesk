import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type ColoredPath,
  type CurveSubpath,
  type ImportedSvg,
} from '../../core/scene';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { useToastStore } from './toast-store';

const curve: CurveSubpath = {
  start: { x: 0, y: 0 },
  closed: false,
  segments: [
    { kind: 'line', to: { x: 0, y: 0.01 } },
    { kind: 'line', to: { x: 0.01, y: 0.01 } },
    {
      kind: 'cubic',
      control1: { x: 0.01, y: 0.005 },
      control2: { x: 0.005, y: 0 },
      to: { x: 0.00005, y: 0 },
    },
  ],
};

function load(source = curve, compatibilityEnd = source.segments.at(-1)!.to): ImportedSvg {
  const object: ImportedSvg = {
    kind: 'imported-svg',
    id: 'source',
    source: 'source.svg',
    bounds: { minX: 0, minY: 0, maxX: 0.01, maxY: 0.01 },
    transform: {
      ...IDENTITY_TRANSFORM,
      scaleX: 10000,
      scaleY: 5000,
      mirrorX: true,
      rotationDeg: 37,
      x: 21,
      y: -13,
    },
    operationIds: ['fill'],
    paths: [
      {
        color: '#000000',
        curves: [source],
        polylines: [
          {
            closed: false,
            points: [
              source.start,
              ...source.segments.slice(0, -1).map((s) => s.to),
              compatibilityEnd,
            ],
          },
        ],
      },
    ],
  };
  useStore.setState({
    project: {
      ...createProject(),
      scene: {
        objects: [object],
        groups: [],
        layers: [createLayer({ id: 'fill', color: '#000000', mode: 'fill' })],
      },
    },
    selectedObjectId: object.id,
  });
  return object;
}

function currentPath(): ColoredPath {
  const object = useStore.getState().project.scene.objects[0] as ImportedSvg;
  return object.paths[0]!;
}

describe('closure commands preserve transformed geometry', () => {
  beforeEach(() => {
    resetStore();
    for (const toast of useToastStore.getState().toasts) {
      useToastStore.getState().dismissToast(toast.id);
    }
  });

  it.each(['close-path', 'fill-default', 'fill-tolerance'] as const)(
    '%s adds only a straight bridge, with one Undo/Redo step and no repeat edit',
    (command) => {
      const original = load();
      const before = useStore.getState().project;
      const close = () => {
        const state = useStore.getState();
        if (command === 'close-path') state.closeSelectedPaths();
        else if (command === 'fill-default') state.closeSelectedOpenFillContours();
        else state.closeSelectedOpenFillContoursWithTolerance(0.51);
      };
      close();
      expect(currentPath().curves![0]).toEqual({
        ...curve,
        closed: true,
        segments: [...curve.segments, { kind: 'line', to: curve.start }],
      });
      expect(currentPath().polylines[0]!.points).toEqual([
        ...original.paths[0]!.polylines[0]!.points,
        curve.start,
      ]);
      expect(useStore.getState().undoStack).toEqual([before]);
      expect(useStore.getState().dirty).toBe(true);
      const after = useStore.getState().project;
      close();
      expect(useStore.getState().project).toBe(after);
      expect(useStore.getState().undoStack).toHaveLength(1);
      useStore.getState().undo();
      expect(useStore.getState().project).toEqual(before);
      useStore.getState().redo();
      expect(useStore.getState().project).toEqual(after);
    },
  );

  it('rejects a gap outside the reviewed world tolerance without changing history', () => {
    load();
    const before = useStore.getState().project;
    useStore.getState().closeSelectedOpenFillContoursWithTolerance(0.49);
    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().undoStack).toHaveLength(0);
    expect(useStore.getState().redoStack).toHaveLength(0);
    expect(useStore.getState().dirty).toBe(false);
    useStore.getState().closeSelectedOpenFillContoursWithTolerance(0.51);
    expect(useStore.getState().undoStack).toEqual([before]);
  });

  it('uses canonical gap size for the Close Path notice and the Fill tolerance gate', () => {
    const wide: CurveSubpath = {
      ...curve,
      segments: [...curve.segments.slice(0, -1), { kind: 'line', to: { x: 0.001, y: 0 } }],
    };
    load(wide, { x: 0.00001, y: 0 });
    const before = useStore.getState().project;
    useStore.getState().closeSelectedOpenFillContoursWithTolerance(0.5);
    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().undoStack).toHaveLength(0);
    useStore.getState().closeSelectedPaths();
    expect(useToastStore.getState().toasts.at(-1)?.message).toBe(
      'Closed 1 path. The widest gap closed was 10 mm.',
    );
    expect(currentPath().curves![0]!.segments).toEqual([
      ...wide.segments,
      { kind: 'line', to: wide.start },
    ]);
  });
});
