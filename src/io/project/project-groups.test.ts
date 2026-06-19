import { describe, expect, it } from 'vitest';
import { createProject, PROJECT_SCHEMA_VERSION, type Project } from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

describe('project scene groups IO', () => {
  it('round-trips durable scene groups', () => {
    const project: Project = {
      ...createProject(),
      scene: {
        ...createProject().scene,
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
    raw['scene'] = { objects: [], layers: [], groups: [{ id: 'bad', name: 'Bad', objectIds: [7] }] };

    const result = deserializeProject(JSON.stringify(raw));

    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') expect(result.reason).toContain('scene.groups');
  });
});
