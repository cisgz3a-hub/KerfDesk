import { afterEach, describe, expect, it } from 'vitest';
import { compileJob } from '../../core/job';
import { effectiveOperationForObject } from '../../core/effective-output';
import {
  captureLayerOperationSettings,
  createLayer,
  createProject,
  operationIdsForObject,
  type ImportedSvg,
  type Layer,
  type ObjectOperationOverride,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { deserializeProject, serializeProject } from '../../io/project';
import { useStore } from './store';
import { resetStore, svgObj } from './test-helpers';

afterEach(resetStore);

describe('persisted artwork operation preservation', () => {
  it('unifies overriding path bindings even when the whole-artwork ID already matches', () => {
    const object = artwork('chosen', { power: 17 });
    const mixed: ImportedSvg = {
      ...object,
      paths: object.paths.map((path) => ({ ...path, operationIds: ['other'] })),
    };
    const before = load([mixed, artwork('peer')], [source(), source('other')]);
    useStore.setState({ additionalSelectedIds: new Set(['peer']) });
    expect(outputFor(before, 'chosen')[0]?.power).toBe(17);

    useStore.getState().useOperationForSelection('shared');

    const after = useStore.getState().project;
    const chosen = after.scene.objects[0]!;
    expect(operationIdsForObject(chosen, after.scene.layers)).toEqual(['shared']);
    expect(chosen.operationOverride).toBeUndefined();
    expect('paths' in chosen && chosen.paths.every((path) => path.operationIds === undefined)).toBe(
      true,
    );
    expect(outputFor(after, 'chosen')[0]?.power).toBe(30);
    expect(outputFor(after, 'chosen')[0]?.segments).toEqual(
      outputFor(before, 'chosen')[0]?.segments,
    );
    expect(useStore.getState().dirty).toBe(true);
    expectUndoRedo(before, after);
  });

  it('clears an artwork override on explicit reassignment and keeps true reassignment no-ops out of undo', () => {
    load([artwork('chosen', { power: 17 })]);
    useStore.getState().useOperationForSelection('shared');
    expect(useStore.getState().project.scene.objects[0]?.operationOverride).toBeUndefined();
    expect(useStore.getState().undoStack).toHaveLength(1);
    const after = useStore.getState().project;
    useStore.getState().useOperationForSelection('shared');
    expect(useStore.getState().project).toBe(after);
    expect(useStore.getState().undoStack).toHaveLength(1);
  });

  it.each(['make unique', 'add'] as const)(
    '%s keeps equivalent selected settings shared and preserves unchanged existing bindings',
    (action) => {
      const before = load([artwork('chosen', { power: 30 }), artwork('second'), artwork('peer')]);
      useStore.setState({ additionalSelectedIds: new Set(['second']) });
      if (action === 'make unique') useStore.getState().makeSelectedOperationUnique('shared');
      else useStore.getState().addOperationForSelection();
      const after = useStore.getState().project;
      const ids = after.scene.objects.map((object) =>
        operationIdsForObject(object, after.scene.layers),
      );
      expect(after.scene.layers).toHaveLength(2);
      expect(ids[0]).toEqual(ids[1]);
      expect(ids[2]).toEqual(['shared']);
      if (action === 'add') expect(ids[0]?.[0]).toBe('shared');
      expect(outputFor(after, 'peer')).toEqual(outputFor(before, 'peer'));
      expectUndoRedo(before, after);
    },
  );

  it('adds a new path-wide operation without broadening either existing path-specific operation', () => {
    const object = artwork('chosen');
    const mixed = {
      ...object,
      paths: [
        { ...object.paths[0]!, operationIds: ['shared'] },
        { ...object.paths[0]!, color: '#ff0000', operationIds: ['other'] },
      ],
    };
    const before = load([mixed], [source(), source('other')]);
    useStore.getState().addOperationForSelection();
    const after = useStore.getState().project;
    const next = after.scene.objects[0] as ImportedSvg;
    const added = after.scene.layers.at(-1)!;
    expect(next.paths.map((path) => path.operationIds)).toEqual([
      ['shared', added.id],
      ['other', added.id],
    ]);
    expect(outputFor(after, 'chosen').slice(0, 2)).toEqual(outputFor(before, 'chosen'));
    expect(next.paths.map((path) => path.curves)).toEqual(
      (before.scene.objects[0] as ImportedSvg).paths.map((path) => path.curves),
    );
  });

  it.each(['make unique', 'add'] as const)(
    '%s preserves heterogeneous effective settings and unselected owners',
    (action) => {
      const overrides: ObjectOperationOverride[] = [
        { mode: 'line', power: 17, minPower: 5, speed: 600, passes: 3, airAssist: true },
        { mode: 'fill', power: 42, minPower: 9, speed: 800, passes: 2, hatchSpacingMm: 1 },
      ];
      const before = load([
        artwork('chosen', overrides[0]),
        artwork('second', overrides[1]),
        artwork('peer'),
      ]);
      useStore.setState({ additionalSelectedIds: new Set(['second']) });
      const expected = ['chosen', 'second'].map((id) => outputFor(before, id));
      expect(expected[0]?.[0]).toMatchObject({
        kind: 'cut',
        power: 17,
        speed: 600,
        passes: 3,
        airAssist: true,
      });
      expect(expected[1]?.[0]).toMatchObject({ kind: 'fill', power: 42, speed: 800, passes: 2 });

      if (action === 'make unique') useStore.getState().makeSelectedOperationUnique('shared');
      else useStore.getState().addOperationForSelection();

      const after = useStore.getState().project;
      for (const [index, id] of ['chosen', 'second'].entries()) {
        expect(outputFor(after, id)).toEqual(
          action === 'add' ? [...expected[index]!, ...expected[index]!] : expected[index],
        );
      }
      expect(outputFor(after, 'peer')).toEqual(outputFor(before, 'peer'));
      expect(after.scene.objects[2]).toBe(before.scene.objects[2]);
      expect(after.scene.layers[0]).toBe(before.scene.layers[0]);
      expect(after.scene.layers).toHaveLength(2);
      for (const [index, id] of ['chosen', 'second'].entries()) {
        const object = after.scene.objects.find((item) => item.id === id)!;
        expect(object.operationOverride).toMatchObject(overrides[index]!);
        const operations = operationIdsForObject(object, after.scene.layers);
        expect(operations).toHaveLength(action === 'add' ? 2 : 1);
        expect(
          operations.map(
            (operationId) =>
              effectiveOperationForObject(
                after.scene.layers.find((layer) => layer.id === operationId)!,
                object,
              ).minPower,
          ),
        ).toEqual(
          action === 'add'
            ? [overrides[index]!.minPower, overrides[index]!.minPower]
            : [overrides[index]!.minPower],
        );
      }
      const saved = reopen(after);
      expect(['chosen', 'second', 'peer'].map((id) => outputFor(saved, id))).toEqual(
        ['chosen', 'second', 'peer'].map((id) => outputFor(after, id)),
      );
      expectUndoRedo(before, after);
    },
  );

  it.each(['make unique', 'add'] as const)(
    '%s retains imported per-path geometry assignments and sub-operation settings',
    (action) => {
      const object = artwork('chosen', { power: 17, passes: 2 });
      const mixed: ImportedSvg = {
        ...object,
        paths: [
          { ...object.paths[0]!, operationIds: ['shared'] },
          {
            ...object.paths[0]!,
            color: '#ff0000',
            operationIds: ['other'],
            polylines: [
              {
                closed: true,
                points: [
                  { x: 20, y: 0 },
                  { x: 25, y: 0 },
                  { x: 25, y: 5 },
                  { x: 20, y: 0 },
                ],
              },
            ],
          },
        ],
      };
      const base = source();
      const subSettings = { ...captureLayerOperationSettings(base), speed: 400, power: 8 };
      const withSub = {
        ...base,
        subLayers: [{ id: 'finish', label: 'Finish', enabled: true, settings: subSettings }],
      };
      const before = load([mixed, artwork('peer')], [withSub, source('other')]);
      const beforeOutput = outputFor(before, 'chosen');
      if (action === 'make unique') useStore.getState().makeSelectedOperationUnique('shared');
      else useStore.getState().addOperationForSelection();

      const after = useStore.getState().project;
      const chosen = after.scene.objects[0]!;
      if (!('paths' in chosen)) throw new Error('Expected path artwork');
      const firstIds = chosen.paths[0]!.operationIds!;
      const secondIds = chosen.paths[1]!.operationIds!;
      expect(firstIds).toHaveLength(action === 'add' ? 2 : 1);
      expect(secondIds).toHaveLength(action === 'add' ? 2 : 1);
      expect(firstIds[0]).not.toBe(secondIds[0]);
      expect(secondIds[0]).toBe('other');
      if (action === 'make unique') expect(firstIds).not.toContain('shared');
      else expect(firstIds[0]).toBe('shared');
      if (action === 'add') expect(firstIds[1]).toBe(secondIds[1]);
      const clone = after.scene.layers.at(-1)!;
      expect(chosen.paths.map((path) => path.curves)).toEqual(
        (before.scene.objects[0] as ImportedSvg).paths.map((path) => path.curves),
      );
      const afterOutput = outputFor(after, 'chosen');
      // The existing operation on each imported path must retain precisely its geometry.
      if (action === 'add') expect(afterOutput.slice(0, beforeOutput.length)).toEqual(beforeOutput);
      else expect(afterOutput).toEqual([beforeOutput[2], beforeOutput[0], beforeOutput[1]]);
      expect(clone.subLayers).toEqual(withSub.subLayers);
      expect(clone.subLayers).not.toBe(after.scene.layers[0]?.subLayers);
      expect(outputFor(reopen(after), 'chosen')).toEqual(afterOutput);
      expectUndoRedo(before, after);
    },
  );
});

function source(id = 'shared'): Layer {
  return {
    ...createLayer({ id, color: id === 'shared' ? '#000000' : '#ff0000' }),
    power: 30,
    speed: 1000,
  };
}

function artwork(id: string, operationOverride?: ObjectOperationOverride): ImportedSvg {
  const object = svgObj(id, ['#000000']);
  return {
    ...object,
    operationIds: ['shared'],
    ...(operationOverride === undefined ? {} : { operationOverride }),
    paths: object.paths.map((path) => ({
      ...path,
      polylines: [
        {
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: 5, y: 0 },
            { x: 5, y: 5 },
            { x: 0, y: 5 },
            { x: 0, y: 0 },
          ],
        },
      ],
    })),
  };
}

function load(objects: ReadonlyArray<SceneObject>, layers = [source()]): Project {
  const project = reopen({ ...createProject(), scene: { objects, layers } });
  useStore.setState({
    project,
    selectedObjectId: 'chosen',
    additionalSelectedIds: new Set(),
    undoStack: [],
    redoStack: [],
    dirty: false,
  });
  return project;
}

function reopen(project: Project): Project {
  const loaded = deserializeProject(serializeProject(project));
  if (loaded.kind !== 'ok') throw new Error(JSON.stringify(loaded));
  return loaded.project;
}

function outputFor(project: Project, objectId: string) {
  const scene = {
    ...project.scene,
    objects: project.scene.objects.filter((object) => object.id === objectId),
  };
  return compileJob(scene, project.device).groups.map((group) => {
    if (group.kind === 'cnc' || group.kind === 'raster')
      throw new Error('Expected laser vector output');
    const {
      layerId: _id,
      color: _color,
      sourceObjectId: _objectId,
      operationSettings: _settings,
      ...output
    } = group;
    return output;
  });
}

function expectUndoRedo(before: Project, after: Project): void {
  expect(useStore.getState().undoStack).toHaveLength(1);
  useStore.getState().undo();
  expect(useStore.getState().project).toEqual(before);
  useStore.getState().redo();
  expect(useStore.getState().project).toEqual(after);
}
