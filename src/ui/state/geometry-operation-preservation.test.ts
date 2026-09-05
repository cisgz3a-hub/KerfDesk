import { beforeEach, expect, it } from 'vitest';
import { compileCncJob } from '../../core/cnc';
import { effectiveOperationForObject } from '../../core/effective-output';
import { compileJob } from '../../core/job';
import {
  applyTransform,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  operationIdsForObject,
  pathUsesOperation,
  type ColoredPath,
  type ImportedSvg,
  type TextObject,
} from '../../core/scene';
import { useStore } from './store';
import { resetStore } from './test-helpers';

beforeEach(resetStore);

function square(color: string, x: number): ColoredPath {
  return {
    color,
    polylines: [
      {
        closed: true,
        points: [
          { x, y: 0 },
          { x: x + 10, y: 0 },
          { x: x + 10, y: 10 },
          { x, y: 10 },
          { x, y: 0 },
        ],
      },
    ],
  };
}

function artwork(id = 'mixed'): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 40, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [square('#ff0000', 0), square('#0000ff', 30)],
  };
}

it('Dogbone preserves each CNC operation region and its distinct depth through compilation and undo', () => {
  useStore.getState().setMachineKind('cnc');
  useStore.getState().importSvgObject(artwork());
  const imported = useStore.getState().project.scene.objects[0]!;
  const splitX = applyTransform({ x: 20, y: 5 }, imported.transform).x;
  const ids = operationIdsForObject(imported, useStore.getState().project.scene.layers);
  ids.forEach((id, index) =>
    useStore.getState().setLayerParam(id, {
      cnc: {
        ...DEFAULT_CNC_LAYER_SETTINGS,
        cutType: 'engrave',
        depthMm: index + 1,
        depthPerPassMm: 3,
      },
    }),
  );
  useStore.getState().selectObject(imported.id);
  useStore.getState().setObjectsPowerScale([imported.id], 50);
  useStore.getState().setSelectedObjectsOperationOverride({ power: 19 });
  const before = useStore.getState().project;
  useStore.getState().dogboneSelection(2);
  const after = useStore.getState().project;
  const result = after.scene.objects[0]!;
  expect(operationIdsForObject(result, after.scene.layers)).toEqual(ids);
  expect(result.powerScale).toBe(50);
  expect(result.operationOverride).toEqual({ power: 19 });
  expect(after.scene.layers).toBe(before.scene.layers);
  const job = compileCncJob(after.scene, after.device, DEFAULT_CNC_MACHINE_CONFIG);
  expect(job.groups.map((group) => group.layerId)).toEqual(ids);
  for (const [index, group] of job.groups.entries()) {
    if (group.kind !== 'cnc') throw new Error('expected CNC group');
    expect(group.passes.length).toBeGreaterThan(0);
    for (const pass of group.passes) {
      if (pass.kind !== 'contour') throw new Error('expected engraving contour');
      expect(pass.zMm).toBe(-(index + 1));
      expect(
        pass.polyline.every((point) => (index === 0 ? point.x < splitX : point.x > splitX)),
      ).toBe(true);
    }
  }
  useStore.getState().undo();
  expect(useStore.getState().project).toBe(before);
});

it('Dogbone keeps a shared path in both operations while their other paths remain independent', () => {
  useStore.getState().importSvgObject(artwork());
  const before = useStore.getState().project.scene;
  const [a, b] = before.layers;
  if (!a || !b) throw new Error('expected operations');
  const object = before.objects[0] as ImportedSvg;
  useStore.setState({
    project: {
      ...useStore.getState().project,
      scene: {
        ...before,
        objects: [
          {
            ...object,
            paths: [{ ...object.paths[0]!, operationIds: [a.id, b.id] }, object.paths[1]!],
          },
        ],
      },
    },
  });
  useStore.getState().selectObject(object.id);
  useStore.getState().dogboneSelection(2);
  const after = useStore.getState().project.scene.objects[0] as ImportedSvg;
  const forA = after.paths.filter((path) => pathUsesOperation(after, path, a));
  const forB = after.paths.filter((path) => pathUsesOperation(after, path, b));
  expect(forA.flatMap((path) => path.polylines)).toHaveLength(1);
  expect(forB.flatMap((path) => path.polylines)).toHaveLength(2);
});

it('Break Apart preserves path operations, group/run order membership, and output settings', () => {
  useStore.getState().importSvgObject(artwork());
  const original = useStore.getState().project.scene;
  const ids = operationIdsForObject(original.objects[0]!, original.layers);
  ids.forEach((id, index) =>
    useStore.getState().setLayerParam(id, { power: 20 + index * 30, speed: 1000 + index * 1000 }),
  );
  useStore.setState((state) => ({
    project: {
      ...state.project,
      scene: {
        ...state.project.scene,
        groups: [{ id: 'group', name: 'Parts', objectIds: ['mixed', 'other'] }],
        objects: [
          ...state.project.scene.objects,
          { ...artwork('other'), paths: [square('#000000', 0)] },
        ],
        artworkOrder: ['other', 'mixed'],
      },
    },
  }));
  const before = useStore.getState().project;
  useStore.setState({ selectedObjectId: 'mixed', additionalSelectedIds: new Set() });
  useStore.getState().breakApartSelection();
  const after = useStore.getState().project;
  const parts = after.scene.objects.filter((object) => object.id !== 'other');
  expect(parts.map((object) => operationIdsForObject(object, after.scene.layers))).toEqual(
    ids.map((id) => [id]),
  );
  expect(after.scene.groups?.[0]?.objectIds).toEqual([...parts.map((part) => part.id), 'other']);
  expect(after.scene.artworkOrder).toEqual(['other', ...parts.map((part) => part.id)]);
  const groups = compileJob(after.scene, after.device).groups;
  ids.forEach((id, index) =>
    expect(groups.find((group) => group.layerId === id)).toMatchObject({
      power: 20 + index * 30,
      speed: 1000 + index * 1000,
    }),
  );
  useStore.getState().undo();
  expect(useStore.getState().project).toBe(before);
});

it('editing text retains object execution metadata', () => {
  const text: TextObject = {
    kind: 'text',
    id: 'text',
    content: 'Before',
    fontKey: 'roboto-regular',
    sizeMm: 10,
    alignment: 'left',
    lineHeight: 1.2,
    letterSpacing: 0,
    color: '#000000',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [square('#000000', 0)],
  };
  useStore.getState().upsertTextObject(text);
  useStore.getState().setObjectsPowerScale([text.id], 50);
  useStore.getState().setSelectedObjectsOperationOverride({ power: 10, speed: 1234 });
  const before = useStore.getState().project;
  useStore.getState().upsertTextObject({ ...text, content: 'After' });
  const after = useStore.getState().project.scene.objects[0]!;
  expect(after.powerScale).toBe(50);
  expect(after.operationOverride).toEqual({ power: 10, speed: 1234 });
  expect(after.operationIds).toEqual(before.scene.objects[0]!.operationIds);
  expect(compileJob(useStore.getState().project.scene, before.device).groups[0]).toMatchObject({
    power: 5,
    speed: 1234,
  });
});

it('Make Unique retains different effective overrides on selected and unselected members', () => {
  ['a', 'b', 'c'].forEach((id) =>
    useStore.getState().importSvgObject({ ...artwork(id), paths: [square('#000000', 0)] }),
  );
  const id = useStore.getState().project.scene.layers[0]!.id;
  useStore.getState().useOperationForObjects(['a', 'b', 'c'], id);
  ['a', 'b'].forEach((objectId, index) => {
    useStore.getState().selectObject(objectId);
    useStore.getState().setSelectedObjectsOperationOverride({
      power: 10 + index,
      speed: 1234 + index,
      negativeImage: false,
    });
  });
  const before = useStore.getState().project.scene;
  useStore.getState().makeOperationUniqueForObjects(['a', 'b'], id);
  const after = useStore.getState().project.scene;
  ['a', 'b', 'c'].forEach((objectId) => {
    const old = before.objects.find((object) => object.id === objectId)!;
    const next = after.objects.find((object) => object.id === objectId)!;
    const operation = after.layers.find((layer) =>
      operationIdsForObject(next, after.layers).includes(layer.id),
    )!;
    const expected = effectiveOperationForObject(before.layers[0]!, old);
    const actual = effectiveOperationForObject(operation, next);
    expect([actual.power, actual.speed, actual.negativeImage]).toEqual([
      expected.power,
      expected.speed,
      expected.negativeImage,
    ]);
    expect(operation.id === id).toBe(objectId === 'c');
  });
});
