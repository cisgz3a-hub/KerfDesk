import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { compileJob } from '../../core/job';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  sceneLayerVisibility,
  type ImportedSvg,
} from '../../core/scene';
import { deserializeProject, serializeProject } from '../../io/project';
import { useStore } from './store';
import { resetStore } from './test-helpers';

function object(id: string, x: number): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: x, minY: 0, maxX: x + 8, maxY: 8 },
    transform: IDENTITY_TRANSFORM,
    operationIds: ['shared'],
    paths: [
      {
        color: '#ff0000',
        polylines: [
          {
            closed: true,
            points: [
              { x, y: 0 },
              { x: x + 8, y: 0 },
              { x: x + 8, y: 8 },
              { x, y: 8 },
              { x, y: 0 },
            ],
          },
        ],
      },
    ],
  };
}

describe('Weld state ownership and persistence', () => {
  beforeEach(() => resetStore());

  it('replaces at the earliest scene/order positions and round-trips one undo step', () => {
    const a = object('a', 0);
    const untouched = object('untouched', 20);
    const c = object('c', 40);
    const shared = { ...createLayer({ id: 'shared', color: '#ff0000' }), power: 42, speed: 420 };
    const original = {
      ...createProject(),
      scene: {
        objects: [a, untouched, c],
        layers: [shared],
        groups: [
          { id: 'group', name: 'Selected and untouched', objectIds: ['a', 'untouched', 'c'] },
        ],
        artworkOrder: ['untouched', 'c', 'a'],
      },
    };
    const beforeJob = compileJob(original.scene, DEFAULT_DEVICE_PROFILE);
    useStore.setState({
      project: original,
      selectedObjectId: 'a',
      additionalSelectedIds: new Set(['c']),
      dirty: false,
    });

    useStore.getState().weldSelection();

    const after = useStore.getState();
    const weldedProject = after.project;
    const welded = weldedProject.scene.objects.find((candidate) => candidate.id !== 'untouched');
    expect(weldedProject.scene.objects.map((candidate) => candidate.id)).toEqual([
      welded?.id,
      'untouched',
    ]);
    expect(weldedProject.scene.artworkOrder).toEqual(['untouched', welded?.id]);
    expect(weldedProject.scene.groups).toEqual([]);
    expect(weldedProject.scene.layers[0]).toBe(shared);
    expect(weldedProject.scene.layers).toHaveLength(1);
    expect(
      compileJob(weldedProject.scene, DEFAULT_DEVICE_PROFILE).groups.map((group) => group.layerId),
    ).toEqual(beforeJob.groups.map((group) => group.layerId));
    expect(after.undoStack).toEqual([original]);

    after.undo();
    expect(useStore.getState().project).toEqual(original);
    useStore.getState().redo();
    expect(useStore.getState().project).toEqual(weldedProject);

    const reopened = deserializeProject(serializeProject(weldedProject));
    expect(reopened.kind).toBe('ok');
    if (reopened.kind === 'ok') {
      expect(compileJob(reopened.project.scene, DEFAULT_DEVICE_PROFILE)).toEqual(
        compileJob(weldedProject.scene, DEFAULT_DEVICE_PROFILE),
      );
    }
  });

  it('does not manufacture output for explicit-empty paths and survives reopen', () => {
    const blue = { ...createLayer({ id: 'blue', color: '#0000ff' }), power: 90, speed: 900 };
    const source: ImportedSvg = {
      kind: 'imported-svg',
      id: 'mixed',
      source: 'mixed.svg',
      bounds: { minX: 0, minY: 0, maxX: 28, maxY: 8 },
      transform: IDENTITY_TRANSFORM,
      paths: [
        { ...object('unbound', 0).paths[0]!, operationIds: [] },
        { ...object('bound', 20).paths[0]!, color: '#0000ff', operationIds: ['blue'] },
      ],
    };
    const original = {
      ...createProject(),
      scene: { objects: [source], layers: [blue], groups: [], artworkOrder: ['mixed'] },
    };
    useStore.setState({ project: original, selectedObjectId: 'mixed', dirty: false });

    useStore.getState().weldSelection();

    const weldedProject = useStore.getState().project;
    const welded = weldedProject.scene.objects[0];
    expect(weldedProject.scene.layers).toEqual([blue]);
    expect(
      welded !== undefined && 'paths' in welded
        ? welded.paths.map((path) => path.operationIds)
        : [],
    ).toEqual([[], ['blue']]);
    expect(minCompiledX(weldedProject.scene)).toBe(20);
    const reopened = deserializeProject(serializeProject(weldedProject));
    expect(reopened.kind).toBe('ok');
    if (reopened.kind === 'ok') {
      const reopenedObject = reopened.project.scene.objects[0];
      expect(
        reopenedObject !== undefined && 'paths' in reopenedObject
          ? reopenedObject.paths.map((path) => path.operationIds)
          : [],
      ).toEqual([[], ['blue']]);
      expect(minCompiledX(reopened.project.scene)).toBe(20);
    }
  });

  it('keeps an orphan-only Weld fail-visible and output-inert through reopen', () => {
    const source = { ...object('orphan', 0), operationIds: ['missing-operation'] };
    const original = {
      ...createProject(),
      scene: { objects: [source], layers: [], groups: [], artworkOrder: ['orphan'] },
    };
    useStore.setState({ project: original, selectedObjectId: 'orphan', dirty: false });

    useStore.getState().weldSelection();

    const weldedProject = useStore.getState().project;
    const welded = weldedProject.scene.objects[0];
    expect(
      welded !== undefined && 'paths' in welded ? welded.paths[0]?.operationIds : undefined,
    ).toEqual(['missing-operation']);
    expect(
      welded !== undefined && 'paths' in welded
        ? sceneLayerVisibility.resolvePath(welded, welded.paths[0]!, new Map()).visible
        : false,
    ).toBe(true);
    expect(compileJob(weldedProject.scene, DEFAULT_DEVICE_PROFILE).groups).toEqual([]);

    const reopened = deserializeProject(serializeProject(weldedProject));
    expect(reopened.kind).toBe('ok');
    if (reopened.kind === 'ok') {
      const reopenedObject = reopened.project.scene.objects[0];
      expect(
        reopenedObject !== undefined && 'paths' in reopenedObject
          ? reopenedObject.paths[0]?.operationIds
          : undefined,
      ).toEqual(['missing-operation']);
      expect(compileJob(reopened.project.scene, DEFAULT_DEVICE_PROFILE).groups).toEqual([]);
    }
  });

  it('retains partial orphan ownership after deleting its live operation', () => {
    const blue = createLayer({ id: 'blue', color: '#0000ff' });
    const source: ImportedSvg = {
      ...withoutObjectOperationIds(object('partial', 0)),
      paths: [
        {
          ...object('partial-path', 0).paths[0]!,
          color: '#0000ff',
          operationIds: ['blue', 'missing-operation'],
        },
      ],
    };
    const original = {
      ...createProject(),
      scene: { objects: [source], layers: [blue], groups: [], artworkOrder: ['partial'] },
    };
    useStore.setState({ project: original, selectedObjectId: 'partial', dirty: false });

    useStore.getState().weldSelection();
    const weldedProject = useStore.getState().project;
    const reopened = deserializeProject(serializeProject(weldedProject));
    expect(reopened.kind).toBe('ok');
    if (reopened.kind !== 'ok') return;
    useStore.setState({
      project: reopened.project,
      selectedObjectId: reopened.project.scene.objects[0]?.id ?? null,
    });

    useStore.getState().deleteLayerAndObjects('blue');

    const afterDelete = useStore.getState().project;
    const remaining = afterDelete.scene.objects[0];
    expect(afterDelete.scene.layers).toEqual([]);
    expect(
      remaining !== undefined && 'paths' in remaining
        ? remaining.paths.map((path) => path.operationIds)
        : [],
    ).toContainEqual(['missing-operation']);
    expect(
      remaining !== undefined && 'paths' in remaining
        ? remaining.paths.some(
            (path) => sceneLayerVisibility.resolvePath(remaining, path, new Map()).visible,
          )
        : false,
    ).toBe(true);
    expect(compileJob(afterDelete.scene, DEFAULT_DEVICE_PROFILE).groups).toEqual([]);
  });

  it('does not activate persisted orphan IDs or legacy colors and survives reopen', () => {
    const selected = { ...object('selected', 0), powerScale: 50 };
    const orphan = {
      ...object('orphan', 30),
      operationIds: ['operation-welded-paths'],
    };
    const legacy: ImportedSvg = {
      ...withoutObjectOperationIds(object('legacy', 50)),
      paths: object('legacy-path', 50).paths.map((path) => ({
        ...path,
        color: '#000000',
      })),
    };
    const sameColorLegacy: ImportedSvg = {
      ...withoutObjectOperationIds(object('same-color-legacy', 70)),
      paths: object('same-color-legacy-path', 70).paths,
    };
    const shared = createLayer({ id: 'shared', color: '#ff0000' });
    const original = {
      ...createProject(),
      scene: {
        objects: [selected, orphan, legacy, sameColorLegacy],
        layers: [shared],
        groups: [],
        artworkOrder: ['selected', 'orphan', 'legacy', 'same-color-legacy'],
      },
    };
    useStore.setState({ project: original, selectedObjectId: 'selected', dirty: false });

    useStore.getState().weldSelection();

    const weldedProject = useStore.getState().project;
    expect(weldedProject.scene.layers.map((layer) => layer.id)).not.toContain(
      'operation-welded-paths',
    );
    expect(compiledGroupBounds(weldedProject.scene)).toEqual([
      { power: 15, minX: 0, maxX: 8 },
      { power: 30, minX: 70, maxX: 78 },
    ]);
    const reopened = deserializeProject(serializeProject(weldedProject));
    expect(reopened.kind).toBe('ok');
    if (reopened.kind === 'ok') {
      expect(compiledGroupBounds(reopened.project.scene)).toEqual([
        { power: 15, minX: 0, maxX: 8 },
        { power: 30, minX: 70, maxX: 78 },
      ]);
    }
  });
});

function minCompiledX(scene: Parameters<typeof compileJob>[0]): number {
  return compiledPoints(scene).reduce(
    (minX, point) => Math.min(minX, point.x),
    Number.POSITIVE_INFINITY,
  );
}

function compiledPoints(scene: Parameters<typeof compileJob>[0]) {
  return compileJob(scene, DEFAULT_DEVICE_PROFILE)
    .groups.filter((group) => group.kind === 'cut' || group.kind === 'fill')
    .flatMap((group) => group.segments.flatMap((segment) => segment.polyline));
}

function compiledGroupBounds(scene: Parameters<typeof compileJob>[0]) {
  return compileJob(scene, DEFAULT_DEVICE_PROFILE)
    .groups.flatMap((group) => {
      if (group.kind !== 'cut' && group.kind !== 'fill') return [];
      const points = group.segments.flatMap((segment) => segment.polyline);
      return [
        {
          power: group.power,
          minX: points.reduce((value, point) => Math.min(value, point.x), Number.POSITIVE_INFINITY),
          maxX: points.reduce((value, point) => Math.max(value, point.x), Number.NEGATIVE_INFINITY),
        },
      ];
    })
    .sort((left, right) => left.minX - right.minX);
}

function withoutObjectOperationIds(value: ImportedSvg): ImportedSvg {
  const { operationIds: _operationIds, ...objectWithoutOperationIds } = value;
  return objectWithoutOperationIds;
}
