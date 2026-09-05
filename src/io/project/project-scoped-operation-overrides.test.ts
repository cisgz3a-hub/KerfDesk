import { describe, expect, it } from 'vitest';
import { compileJob } from '../../core/job';
import { compileCncJob } from '../../core/cnc';
import {
  captureLayerOperationSettings,
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  PROJECT_SCHEMA_VERSION,
  type ObjectOperationOverride,
  type Project,
} from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

describe('schema v5 operation override ownership', () => {
  it.each([1, 2, 3, 4, 5])(
    'ignores non-setting legacy fields without changing schema v%s output or CNC ownership',
    (schemaVersion) => {
      const project = fixture({ power: 17, speed: 600 });
      const scene = {
        ...project.scene,
        layers: project.scene.layers.map((layer) => ({
          ...layer,
          cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, depthMm: 1 },
        })),
      };
      const baseline = loadRaw({ ...project, scene, schemaVersion });
      const nonSettings = [
        { id: 'forged-id' },
        { bindingOperationId: 'unbound-parent' },
        { color: '#ff00ff' },
        { name: 'forged-name' },
        { output: false },
        { visible: false },
        { cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'pocket', depthMm: 2 } },
        { subLayers: [] },
        { legacyMetadata: { note: 'retain this' } },
      ];
      for (const metadata of nonSettings) {
        const override = { power: 17, speed: 600, ...metadata };
        const objects = scene.objects.map((object) => ({ ...object, operationOverride: override }));
        const loaded = loadRaw({ ...project, schemaVersion, scene: { ...scene, objects } });
        expect(compileJob(loaded.scene, loaded.device).groups).toEqual(
          compileJob(baseline.scene, baseline.device).groups,
        );
        expect(
          compileCncJob(loaded.scene, loaded.device, DEFAULT_CNC_MACHINE_CONFIG).groups,
        ).toEqual(
          compileCncJob(baseline.scene, baseline.device, DEFAULT_CNC_MACHINE_CONFIG).groups,
        );
        if (schemaVersion >= 3)
          expect(loaded.scene.objects[0]?.operationOverride).toEqual(override);
        expect(reopen(loaded)).toEqual(loaded);
      }
    },
  );

  it.each([1, 2, 3, 4])(
    'preserves schema v%s legacy effective output during migration',
    (schemaVersion) => {
      const original = fixture({ power: 17, speed: 600 });
      const loaded = deserializeProject(JSON.stringify({ ...original, schemaVersion }));
      if (loaded.kind !== 'ok') throw new Error(JSON.stringify(loaded));
      expect(loaded.project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
      expect(facts(loaded.project)).toEqual(facts(original));
      expect(reopen(loaded.project)).toEqual(loaded.project);
    },
  );

  it.each([
    {
      override: { power: 17, speed: 600 },
      expected: [
        [17, 600],
        [17, 600],
      ],
    },
    {
      override: { power: 17, speed: 600, byOperation: { shared: { power: 23 } } },
      expected: [
        [23, 1000],
        [23, 400],
      ],
    },
    {
      override: { power: 17, speed: 600, byOperation: { shared: null } },
      expected: [
        [30, 1000],
        [8, 400],
      ],
    },
    {
      override: {
        power: 17,
        speed: 600,
        byOperation: { shared: { power: 23 }, 'shared:finish': null },
      },
      expected: [
        [23, 1000],
        [8, 400],
      ],
    },
    {
      override: { power: 17, byOperation: { 'shared:finish': { power: 11 } } },
      expected: [
        [17, 1000],
        [11, 400],
      ],
    },
  ])(
    'round-trips mixed legacy and operation-owned settings: $override',
    ({ override, expected }) => {
      const project = fixture(override as ObjectOperationOverride);
      const loaded = reopen(project);
      expect(loaded.scene.objects[0]?.operationOverride).toEqual(override);
      expect(facts(loaded)).toEqual(expected);
      expect(loaded.schemaVersion).toBe(5);
    },
  );

  it.each([
    { byOperation: [] },
    { byOperation: null },
    { byOperation: { '': { power: 10 } } },
    { byOperation: { shared: { speed: 0 } } },
    { byOperation: { shared: { power: 101 } } },
    { byOperation: { shared: { byOperation: {} } } },
    { byOperation: { shared: { id: 'other' } } },
    { byOperation: { shared: { color: '#ff0000' } } },
    { byOperation: { shared: false } },
    { byOperation: { absent: { power: 10 } } },
    { byOperation: { 'shared:absent': null } },
  ])('rejects malformed or dangling scoped settings: %j', (operationOverride) => {
    const project = fixture({});
    const objects = project.scene.objects.map((object) => ({ ...object, operationOverride }));
    const result = deserializeProject(
      JSON.stringify({ ...project, scene: { ...project.scene, objects } }),
    );
    expect(result.kind).toBe('invalid');
  });

  it('keeps the existing legacy orphan binding contract when no scoped settings reference it', () => {
    const project = fixture({ power: 17 });
    const objects = project.scene.objects.map((object) => ({
      ...object,
      operationIds: ['missing'],
    }));
    const loaded = reopen({ ...project, scene: { ...project.scene, objects } });
    expect(facts(loaded)).toEqual([]);
    expect(loaded.scene.objects[0]?.operationIds).toEqual(['missing']);
  });

  it('rejects an ambiguous new scope without changing legacy operation-ID compatibility', () => {
    const project = fixture({ power: 17 });
    const scene = {
      ...project.scene,
      layers: [...project.scene.layers, createLayer({ id: 'shared:finish', color: '#ff0000' })],
    };
    expect(deserializeProject(serializeProject({ ...project, scene })).kind).toBe('ok');
    const objects = scene.objects.map((object) => ({
      ...object,
      operationOverride: { byOperation: { 'shared:finish': null } },
    }));
    expect(
      deserializeProject(JSON.stringify({ ...project, scene: { ...scene, objects } })).kind,
    ).toBe('invalid');
  });
});

function fixture(operationOverride: ObjectOperationOverride): Project {
  const layer = { ...createLayer({ id: 'shared', color: '#000000' }), speed: 1000 };
  const source = {
    ...layer,
    subLayers: [
      {
        id: 'finish',
        label: 'Finish',
        enabled: true,
        settings: { ...captureLayerOperationSettings(layer), power: 8, speed: 400 },
      },
    ],
  };
  const object = {
    ...createRectangle({
      id: 'art',
      color: '#000000',
      spec: { widthMm: 5, heightMm: 5, cornerRadiusMm: 0 },
    }),
    operationIds: ['shared'],
    operationOverride,
  };
  return { ...createProject(), scene: { objects: [object], layers: [source] } };
}

function reopen(project: Project): Project {
  const loaded = deserializeProject(serializeProject(project));
  if (loaded.kind !== 'ok') throw new Error(JSON.stringify(loaded));
  return loaded.project;
}

function loadRaw(raw: unknown): Project {
  const loaded = deserializeProject(JSON.stringify(raw));
  if (loaded.kind !== 'ok') throw new Error(JSON.stringify(loaded));
  return loaded.project;
}

function facts(project: Project) {
  return compileJob(project.scene, project.device).groups.map((group) => {
    if (group.kind === 'cnc') throw new Error('Expected laser output');
    return [group.power, group.speed];
  });
}
