import { PROJECT_SCHEMA_VERSION } from '../../core/scene/project';
import { describe, expect, it } from 'vitest';
import { createProject, createLayer, type Project, type Scene } from '../../core/scene';
import { compoundRectangle } from '../../core/geometry/boolean-compound.test-fixture';
import {
  captureBooleanCompound,
  evaluateBooleanCompound,
} from '../../core/geometry/boolean-compound';
import { deserializeProject, serializeProject } from './index';
import { validateSceneBudgets } from './project-scene-integrity-validator';
import { prepareProjectForPersistence } from './prepare-project-persistence';

describe('schema14 durable design workflows', () => {
  it('reads schema13 without inventing compound or hierarchy intent', () => {
    const original = { ...createProject(), schemaVersion: 13 };
    const loaded = deserializeProject(JSON.stringify(original));
    expect(loaded.kind).toBe('ok');
    if (loaded.kind !== 'ok') throw new Error('Legacy load failed');
    expect(loaded.project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(loaded.project.scene.objects).toEqual(original.scene.objects);
    expect(loaded.project.scene.designTreeOrder).toBeUndefined();
  });
  it('roundtrips presentation ranks independently of artwork/output order', () => {
    const a = compoundRectangle('a');
    const b = compoundRectangle('b', 5);
    const scene: Scene = {
      objects: [a, b],
      layers: [createLayer({ id: 'cut', color: '#000000' })],
      groups: [],
      artworkOrder: ['a', 'b'],
      designTreeOrder: [
        { kind: 'object', id: 'b' },
        { kind: 'object', id: 'a' },
      ],
    };
    const loaded = deserializeProject(serializeProject({ ...createProject(), scene }));
    expect(loaded.kind).toBe('ok');
    if (loaded.kind !== 'ok') throw new Error('Roundtrip failed');
    expect(loaded.project.scene.designTreeOrder).toEqual(scene.designTreeOrder);
    expect(loaded.project.scene.artworkOrder).toEqual(['a', 'b']);
    expect(loaded.project.scene.objects.map((object) => object.id)).toEqual(['a', 'b']);
  });
  it('rejects duplicate/invalid ranks while tolerating stale deleted identities', () => {
    const project = createProject();
    const read = (designTreeOrder: unknown) =>
      deserializeProject(
        JSON.stringify({ ...project, scene: { ...project.scene, designTreeOrder } }),
      );
    expect(read([{ kind: 'object', id: 'deleted' }]).kind).toBe('ok');
    expect(
      read([
        { kind: 'object', id: 'a' },
        { kind: 'object', id: 'a' },
      ]).kind,
    ).toBe('invalid');
    expect(read([{ kind: 'layer', id: 'a' }]).kind).toBe('invalid');
  });
  it('reevaluates retained operands rather than trusting a forged result cache', () => {
    const subject = compoundRectangle('subject');
    const clip = compoundRectangle('clip', 5);
    const captured = captureBooleanCompound('subtract', [subject, clip]);
    if (captured.kind !== 'ok') throw new Error('Capture failed');
    const evaluated = evaluateBooleanCompound({
      ...subject,
      id: 'result',
      booleanCompound: captured.value,
    });
    if (evaluated.kind !== 'ok') throw new Error('Evaluation failed');
    const project = {
      ...createProject(),
      scene: {
        ...createProject().scene,
        objects: [evaluated.value],
        layers: [createLayer({ id: 'cut', color: '#000000' })],
      },
    };
    const raw = JSON.parse(serializeProject(project));
    raw.scene.objects[0].paths = [
      {
        color: '#000000',
        polylines: [
          {
            closed: true,
            points: [
              { x: 999, y: 999 },
              { x: 998, y: 999 },
              { x: 999, y: 998 },
            ],
          },
        ],
      },
    ];
    const loaded = deserializeProject(JSON.stringify(raw));
    expect(loaded.kind).toBe('ok');
    if (loaded.kind !== 'ok') throw new Error('Load failed');
    const object = loaded.project.scene.objects[0];
    if (object?.kind !== 'imported-svg') throw new Error('Compound missing');
    expect(object.paths).toEqual(evaluated.value.paths);
  });
  it('counts retained sources against the existing scene allocation budget', () => {
    const objects = Array.from({ length: 11 }, () => ({
      booleanCompound: { operands: Array.from({ length: 1000 }, () => ({})) },
    }));
    expect(validateSceneBudgets({ objects, layers: [], groups: [] })).toContain('10000');
  });
  it.each(['', ' \t'])('refuses blank scene identities %j before they can become ranks', (id) => {
    const project: Project = {
      ...createProject(),
      scene: {
        objects: [compoundRectangle('a'), compoundRectangle('b', 5)],
        layers: [createLayer({ id: 'cut', color: '#000000' })],
        groups: [{ id: 'group', name: 'Pair', objectIds: ['a', 'b'] }],
      },
    };
    const scenes: Scene[] = [
      {
        ...project.scene,
        objects: [{ ...project.scene.objects[0]!, id }, project.scene.objects[1]!],
      },
      { ...project.scene, layers: [{ ...project.scene.layers[0]!, id }] },
      { ...project.scene, groups: [{ id, name: 'Pair', objectIds: ['a', 'b'] }] },
    ];
    expect(prepareProjectForPersistence(project).kind).toBe('ok');
    for (const scene of scenes) {
      const malformed = { ...project, scene };
      const loaded = deserializeProject(serializeProject(malformed));
      const saved = prepareProjectForPersistence(malformed);
      expect(loaded.kind).toBe('invalid');
      expect(saved.kind).toBe('invalid');
      if (loaded.kind === 'invalid') expect(loaded.reason).toContain('blank id');
      if (saved.kind === 'invalid') expect(saved.reason).toContain('blank id');
    }
  });
});
