import { describe, expect, it } from 'vitest';
import {
  createProject,
  IDENTITY_TRANSFORM,
  PROJECT_SCHEMA_VERSION,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

function groupObject(id: string): SceneObject {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#ff0000', polylines: [{ closed: false, points: [{ x: 0, y: 0 }] }] }],
  };
}

describe('project scene groups IO', () => {
  it('round-trips durable scene groups', () => {
    const base = createProject();
    const project: Project = {
      ...base,
      scene: {
        ...base.scene,
        objects: [groupObject('A'), groupObject('B')],
        groups: [{ id: 'group-1', name: 'Group 1', objectIds: ['A', 'B'] }],
      },
    };

    const result = deserializeProject(serializeProject(project));

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.project.scene.groups).toEqual([
        { id: 'group-1', name: 'Group 1', objectIds: ['A', 'B'] },
      ]);
    }
  });

  it('backfills old projects without scene.groups to an empty array', () => {
    const oldShape = JSON.stringify({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      device: createProject().device,
      workspace: createProject().workspace,
      scene: { objects: [], layers: [] },
    });

    const result = deserializeProject(oldShape);

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.project.scene.groups).toEqual([]);
  });

  it('rejects malformed group metadata', () => {
    const raw = JSON.parse(serializeProject(createProject())) as Record<string, unknown>;
    raw['scene'] = {
      objects: [],
      layers: [],
      groups: [{ id: 'bad', name: 'Bad', objectIds: [7] }],
    };

    const result = deserializeProject(JSON.stringify(raw));

    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') expect(result.reason).toContain('scene.groups');
  });

  it('rejects groups with dangling object references', () => {
    const raw = JSON.parse(serializeProject(createProject())) as Record<string, unknown>;
    raw['scene'] = {
      objects: [groupObject('A')],
      layers: [],
      groups: [{ id: 'bad', name: 'Bad', objectIds: ['A', 'missing'] }],
    };

    const result = deserializeProject(JSON.stringify(raw));

    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') expect(result.reason).toContain('scene.groups[0].objectIds[1]');
  });

  it('rejects duplicate scene and group identities', () => {
    const raw = JSON.parse(serializeProject(createProject())) as Record<string, unknown>;
    raw['scene'] = {
      objects: [groupObject('A'), groupObject('A')],
      layers: [],
      groups: [],
    };

    const result = deserializeProject(JSON.stringify(raw));

    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') expect(result.reason).toContain('scene.objects[1].id');
  });

  it('rejects duplicate group identities', () => {
    const raw = JSON.parse(serializeProject(createProject())) as Record<string, unknown>;
    raw['scene'] = {
      objects: [groupObject('A'), groupObject('B')],
      layers: [],
      groups: [
        { id: 'G1', name: 'Group 1', objectIds: ['A', 'B'] },
        { id: 'G1', name: 'Group 2', objectIds: ['A', 'A'] },
      ],
    };

    const result = deserializeProject(JSON.stringify(raw));

    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') expect(result.reason).toContain('scene.groups[1].id');
  });

  it('rejects repeated group members', () => {
    const raw = JSON.parse(serializeProject(createProject())) as Record<string, unknown>;
    raw['scene'] = {
      objects: [groupObject('A'), groupObject('B')],
      layers: [],
      groups: [{ id: 'G1', name: 'Group 1', objectIds: ['A', 'A'] }],
    };

    const result = deserializeProject(JSON.stringify(raw));

    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') expect(result.reason).toContain('scene.groups[0].objectIds[1]');
  });
});
