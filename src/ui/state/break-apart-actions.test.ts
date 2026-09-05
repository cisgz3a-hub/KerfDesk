import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type ColoredPath,
  type ImportedSvg,
  type CurveSubpath,
  type TextObject,
} from '../../core/scene';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { useToastStore } from './toast-store';

describe('break apart selection action', () => {
  beforeEach(() => {
    resetStore();
  });

  it('splits a selected multi-path SVG into independently selectable objects', () => {
    loadImportedSvg(
      importedSvg('logo', [squarePath('#000000', 0, 0, 10), squarePath('#000000', 3, 3, 4)]),
    );
    useStore.setState({ selectedObjectId: 'logo', additionalSelectedIds: new Set(), dirty: false });

    useStore.getState().breakApartSelection();

    const state = useStore.getState();
    const objects = state.project.scene.objects;
    expect(objects.map((object) => object.id)).toEqual(['logo__part_1', 'logo__part_2']);
    expect(objects.map((object) => object.kind)).toEqual(['imported-svg', 'imported-svg']);
    expect((objects[0] as ImportedSvg).paths).toEqual([squarePath('#000000', 0, 0, 10)]);
    expect((objects[1] as ImportedSvg).paths).toEqual([squarePath('#000000', 3, 3, 4)]);
    expect(objects[0]?.transform).toEqual(IDENTITY_TRANSFORM);
    expect(objects[1]?.bounds).toEqual({ minX: 3, minY: 3, maxX: 7, maxY: 7 });
    expect(state.selectedObjectId).toBe('logo__part_1');
    expect([...state.additionalSelectedIds]).toEqual(['logo__part_2']);
    expect(state.dirty).toBe(true);
    expect(state.undoStack).toHaveLength(1);
  });

  it('splits a selected single-path multi-contour SVG into independently selectable objects', () => {
    loadImportedSvg(
      importedSvg('compound', [compoundPath('#000000', [square(0, 0, 10), square(3, 3, 4)])]),
    );
    useStore.setState({
      selectedObjectId: 'compound',
      additionalSelectedIds: new Set(),
      dirty: false,
    });

    useStore.getState().breakApartSelection();

    const state = useStore.getState();
    const objects = state.project.scene.objects;
    expect(objects.map((object) => object.id)).toEqual(['compound__part_1', 'compound__part_2']);
    expect((objects[0] as ImportedSvg).paths).toEqual([
      compoundPath('#000000', [square(0, 0, 10)]),
    ]);
    expect((objects[1] as ImportedSvg).paths).toEqual([compoundPath('#000000', [square(3, 3, 4)])]);
    expect(objects[0]?.bounds).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
    expect(objects[1]?.bounds).toEqual({ minX: 3, minY: 3, maxX: 7, maxY: 7 });
    expect(state.selectedObjectId).toBe('compound__part_1');
    expect([...state.additionalSelectedIds]).toEqual(['compound__part_2']);
  });

  it('does nothing for a selected SVG that is already one path', () => {
    const original = importedSvg('one', [squarePath('#000000', 0, 0, 10)]);
    loadImportedSvg(original);
    useStore.setState({ selectedObjectId: 'one' });
    const before = useStore.getState().project;

    useStore.getState().breakApartSelection();

    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().selectedObjectId).toBe('one');
    expect(useStore.getState().dirty).toBe(false);
  });

  it('preserves canonical curves and remaps holding tabs to each split part', () => {
    const curve: CurveSubpath = {
      start: { x: 0, y: 0 },
      closed: false,
      segments: [
        {
          kind: 'cubic',
          control1: { x: 0, y: 10 },
          control2: { x: 10, y: 10 },
          to: { x: 10, y: 0 },
        },
      ],
    };
    const object: ImportedSvg = {
      ...importedSvg('curves', [
        {
          color: '#000000',
          operationIds: ['cut'],
          curves: [curve, curve],
          polylines: [square(0, 0, 10), square(0, 0, 10)],
          strokeWidthMm: 0.4,
        },
      ]),
      powerScale: 60,
      cncTabAnchors: [{ layerColor: '#000000', pathIndex: 0, polylineIndex: 1, pathT: 0.3 }],
    };
    loadImportedSvg(object);
    useStore.setState({ selectedObjectId: object.id });
    useStore.getState().breakApartSelection();
    const [first, second] = useStore.getState().project.scene.objects as ImportedSvg[];
    expect(first?.paths[0]?.curves).toEqual([curve]);
    expect(first?.paths[0]?.operationIds).toEqual(['cut']);
    expect(first?.paths[0]?.strokeWidthMm).toBe(0.4);
    expect(first?.bounds.maxY).toBeCloseTo(7.5);
    expect(first?.cncTabAnchors).toEqual([]);
    expect(second?.cncTabAnchors).toEqual([
      { layerColor: '#000000', pathIndex: 0, polylineIndex: 0, pathT: 0.3 },
    ]);
    expect(second?.powerScale).toBe(60);
  });

  it('detaches a removed path-text guide without changing its rendered text geometry, and undo restores the link', () => {
    const object = importedSvg('guide', [
      compoundPath('#000000', [square(0, 0, 10), square(20, 0, 10)]),
    ]);
    const text: TextObject = {
      kind: 'text',
      id: 'label',
      fontKey: 'roboto-regular',
      content: 'On path',
      sizeMm: 10,
      alignment: 'left',
      lineHeight: 1.2,
      letterSpacing: 0,
      color: '#000000',
      transform: IDENTITY_TRANSFORM,
      bounds: object.bounds,
      paths: [squarePath('#000000', 2, 2, 4)],
      pathText: { guideObjectId: object.id, offsetMm: 0, reverse: false },
    };
    loadImportedSvg(object);
    useStore.setState((state) => ({
      project: { ...state.project, scene: { ...state.project.scene, objects: [object, text] } },
      selectedObjectId: object.id,
    }));
    const before = useStore.getState().project;
    const oldToastCount = useToastStore.getState().toasts.length;
    useStore.getState().breakApartSelection();
    const label = useStore
      .getState()
      .project.scene.objects.find((item) => item.id === text.id) as TextObject;
    expect(label.pathText).toBeUndefined();
    expect(label.paths).toBe(text.paths);
    expect(label.transform).toBe(text.transform);
    expect(useToastStore.getState().toasts.length).toBeGreaterThan(oldToastCount);
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(before);
  });
});

function loadImportedSvg(object: ImportedSvg): void {
  useStore.setState({
    project: {
      ...createProject(),
      scene: {
        objects: [object],
        layers: [createLayer({ id: '#000000', color: '#000000' })],
        groups: [],
      },
    },
  });
}

function importedSvg(id: string, paths: ReadonlyArray<ColoredPath>): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths,
  };
}

function squarePath(color: string, x: number, y: number, size: number): ColoredPath {
  return compoundPath(color, [square(x, y, size)]);
}

function compoundPath(
  color: string,
  polylines: ReadonlyArray<ColoredPath['polylines'][number]>,
): ColoredPath {
  return {
    color,
    polylines,
  };
}

function square(x: number, y: number, size: number): ColoredPath['polylines'][number] {
  return {
    closed: true,
    points: [
      { x, y },
      { x: x + size, y },
      { x: x + size, y: y + size },
      { x, y: y + size },
    ],
  };
}
