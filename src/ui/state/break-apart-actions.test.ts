import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type ColoredPath,
  type ImportedSvg,
} from '../../core/scene';
import { useStore } from './store';
import { resetStore } from './test-helpers';

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
