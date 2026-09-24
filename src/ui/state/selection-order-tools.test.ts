import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type SceneGroup,
  type SceneObject,
} from '../../core/scene';
import { useStore } from './store';
import { resetStore } from './test-helpers';

// Align's reference and Subtract's kept shape follow the order the operator
// picked the selection in, not the stacking order (ADR-377).

describe('tools that follow the pick order', () => {
  beforeEach(() => resetStore());

  it('aligns to the last picked object even when it is lower in the stack', () => {
    load([square('low', 10, 0, 10), square('high', 40, 25, 10)]);

    useStore.getState().selectObject('high');
    useStore.getState().toggleSelectObject('low');
    useStore.getState().alignSelection('left');

    expect(minX('low')).toBeCloseTo(10, 6);
    expect(minX('high')).toBeCloseTo(10, 6);

    useStore.getState().undo();
    useStore.getState().selectObject('low');
    useStore.getState().toggleSelectObject('high');
    useStore.getState().alignSelection('left');

    expect(minX('low')).toBeCloseTo(40, 6);
    expect(minX('high')).toBeCloseTo(40, 6);
  });

  it('keeps the first picked shape in Subtract whatever the stacking order', () => {
    load([square('base', 0, 0, 10), square('cutter', 5, 0, 10)]);

    useStore.getState().selectObject('cutter');
    useStore.getState().toggleSelectObject('base');
    useStore.getState().booleanSelection('subtract');

    expect(onlyObject().bounds).toMatchObject({ minX: 10, maxX: 15 });

    useStore.getState().undo();
    useStore.getState().selectObject('base');
    useStore.getState().toggleSelectObject('cutter');
    useStore.getState().booleanSelection('subtract');

    expect(onlyObject().bounds).toMatchObject({ minX: 0, maxX: 5 });
  });

  it('subtracts a later-picked group as one shape, keeping the island inside its hole', () => {
    load(
      [square('plate', -10, -10, 50), square('outer', 0, 0, 30), square('inner', 10, 10, 10)],
      [{ id: 'donut', name: 'Donut', objectIds: ['outer', 'inner'] }],
    );

    useStore.getState().selectObject('plate');
    useStore.getState().toggleSelectObject('inner');
    useStore.getState().booleanSelection('subtract');

    const result = onlyObject();
    expect(filledArea(result)).toBeCloseTo(2500 - 800, 3);
    expect(result.paths[0]?.polylines).toHaveLength(3);
    expect(useStore.getState().project.scene.groups).toEqual([]);
  });

  it('keeps a first-picked group and cuts the later shape out of its ring', () => {
    load(
      [square('outer', 0, 0, 30), square('inner', 10, 10, 10), rect('bar', -5, 13, 40, 4)],
      [{ id: 'donut', name: 'Donut', objectIds: ['outer', 'inner'] }],
    );

    useStore.getState().selectObject('outer');
    useStore.getState().toggleSelectObject('bar');
    useStore.getState().booleanSelection('subtract');

    // The ring (800) loses two 10 x 4 crossings.
    expect(filledArea(onlyObject())).toBeCloseTo(800 - 80, 3);
  });
});

function load(objects: ReadonlyArray<ImportedSvg>, groups: ReadonlyArray<SceneGroup> = []): void {
  useStore.setState({
    project: {
      ...createProject(),
      scene: {
        objects: objects.map((object) => ({ ...object, operationIds: ['cut'] })),
        layers: [createLayer({ id: 'cut', color: '#222222' })],
        groups,
      },
    },
    undoStack: [],
    dirty: false,
  });
}

function square(id: string, x: number, y: number, size: number): ImportedSvg {
  return rect(id, x, y, size, size);
}

function rect(id: string, x: number, y: number, width: number, height: number): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: x, minY: y, maxX: x + width, maxY: y + height },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#222222',
        polylines: [
          {
            closed: true,
            points: [
              { x, y },
              { x: x + width, y },
              { x: x + width, y: y + height },
              { x, y: y + height },
            ],
          },
        ],
      },
    ],
  };
}

function onlyObject(): ImportedSvg {
  const objects = useStore.getState().project.scene.objects;
  expect(objects).toHaveLength(1);
  const object = objects[0];
  if (object?.kind !== 'imported-svg') throw new Error('expected one path object');
  return object;
}

function minX(id: string): number | undefined {
  const object: SceneObject | undefined = useStore
    .getState()
    .project.scene.objects.find((candidate) => candidate.id === id);
  return object === undefined ? undefined : object.bounds.minX + object.transform.x;
}

function filledArea(object: ImportedSvg): number {
  let sum = 0;
  for (const polyline of object.paths.flatMap((path) => path.polylines)) {
    const points = polyline.points;
    for (let index = 0; index < points.length; index += 1) {
      const a = points[index];
      const b = points[(index + 1) % points.length];
      if (a !== undefined && b !== undefined) sum += a.x * b.y - b.x * a.y;
    }
  }
  return Math.abs(sum) / 2;
}
