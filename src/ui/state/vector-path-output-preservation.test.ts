import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { compileJob } from '../../core/job';
import {
  captureLayerOperationSettings,
  createLayer,
  createLayerSubLayer,
  createProject,
  IDENTITY_TRANSFORM,
  operationIdsForObject,
  type ImportedSvg,
} from '../../core/scene';
import { deserializeProject, serializeProject } from '../../io/project';
import { useStore } from './store';
import { resetStore } from './test-helpers';

function rectangle(id: string, x: number, metadata: Partial<ImportedSvg> = {}): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: x, minY: 0, maxX: x + 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    operationIds: ['base'],
    paths: [
      {
        color: '#ff0000',
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
      },
    ],
    ...metadata,
  };
}

describe('Boolean and Offset output metadata', () => {
  beforeEach(() => resetStore());

  it('keeps the subject override and power scale through Boolean replacement', () => {
    const subject = rectangle('subject', 0, {
      powerScale: 25,
      operationOverride: { mode: 'fill', power: 90, speed: 321, passes: 3, airAssist: true },
    });
    const clip = rectangle('clip', 5);
    load([subject, clip]);
    useStore.setState({ selectedObjectId: 'subject', additionalSelectedIds: new Set(['clip']) });

    useStore.getState().booleanSelection('intersect');

    const state = useStore.getState();
    const result = state.project.scene.objects[0];
    expect(result?.powerScale).toBe(25);
    expect(result?.operationOverride).toBeUndefined();
    const operationId =
      result === undefined
        ? undefined
        : operationIdsForObject(result, state.project.scene.layers)[0];
    const operation = state.project.scene.layers.find((layer) => layer.id === operationId);
    expect(operation).toMatchObject({
      mode: 'fill',
      power: 90,
      speed: 321,
      passes: 3,
      airAssist: true,
    });
    expect(operation?.materialBinding).toBeUndefined();
    expectEffectiveGroups(state.project.scene, operationId, {
      power: 22.5,
      speed: 321,
      passes: 3,
      airAssist: true,
    });
    expectReopenedCompileParity(state.project);
  });

  it('keeps the subject override and power scale on the independent Offset operation', () => {
    const subject = rectangle('subject', 0, {
      powerScale: 25,
      operationOverride: { mode: 'fill', power: 90, speed: 321 },
    });
    load([subject]);
    useStore.setState({ selectedObjectId: 'subject' });

    useStore.getState().offsetSelection(1);

    const state = useStore.getState();
    const offset = state.project.scene.objects.find((object) => object.id !== 'subject');
    expect(offset?.powerScale).toBe(25);
    expect(offset?.operationOverride).toBeUndefined();
    const operationId =
      offset === undefined
        ? undefined
        : operationIdsForObject(offset, state.project.scene.layers)[0];
    const operation = state.project.scene.layers.find((layer) => layer.id === operationId);
    expect(operation).toMatchObject({ mode: 'fill', power: 90, speed: 321 });
    expect(operation?.materialBinding).toBeUndefined();
    expectEffectiveGroups(state.project.scene, operationId, { power: 22.5, speed: 321 });
    expectReopenedCompileParity(state.project);
  });
});

function load(objects: ReadonlyArray<ImportedSvg>): void {
  const root = { ...createLayer({ id: 'base', color: '#ff0000' }), power: 10, speed: 100 };
  const base = {
    ...root,
    materialBinding: {
      libraryId: 'library',
      presetId: 'preset',
      presetRevision: 'rev-1',
      lastResolved: captureLayerOperationSettings(root),
    },
    subLayers: [
      createLayerSubLayer(root, {
        id: 'detail',
        label: 'Detail',
        settings: captureLayerOperationSettings({ ...root, power: 40, speed: 400 }),
      }),
    ],
  };
  useStore.setState({
    project: {
      ...createProject(),
      scene: {
        objects,
        layers: [base],
        groups: [],
        artworkOrder: objects.map((object) => object.id),
      },
    },
    dirty: false,
  });
}

function expectEffectiveGroups(
  scene: Parameters<typeof compileJob>[0],
  operationId: string | undefined,
  expected: {
    readonly power: number;
    readonly speed: number;
    readonly passes?: number;
    readonly airAssist?: boolean;
  },
): void {
  const groups = compileJob(scene, DEFAULT_DEVICE_PROFILE).groups.filter(
    (group) =>
      operationId !== undefined &&
      (group.layerId === operationId || group.layerId.startsWith(`${operationId}:`)),
  );
  expect(groups).toHaveLength(2);
  for (const group of groups) expect(group).toMatchObject({ kind: 'fill', ...expected });
}

function expectReopenedCompileParity(
  project: ReturnType<typeof useStore.getState>['project'],
): void {
  const reopened = deserializeProject(serializeProject(project));
  expect(reopened.kind).toBe('ok');
  if (reopened.kind === 'ok') {
    expect(compileJob(reopened.project.scene, DEFAULT_DEVICE_PROFILE)).toEqual(
      compileJob(project.scene, DEFAULT_DEVICE_PROFILE),
    );
  }
}
