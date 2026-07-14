import { describe, expect, it } from 'vitest';
import { createProject, type Project } from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { prepareProjectForPersistence } from './prepare-project-persistence';

describe('prepareProjectForPersistence', () => {
  it('normalizes the current project before producing validated persistence JSON', () => {
    const project = createProject();
    const withoutNormalizedGroups = {
      ...project,
      scene: { objects: project.scene.objects, layers: project.scene.layers },
    } as Project;

    const prepared = prepareProjectForPersistence(withoutNormalizedGroups);

    expect(prepared.kind).toBe('ok');
    if (prepared.kind !== 'ok') return;
    expect(prepared.project.scene.groups).toEqual([]);
    expect(deserializeProject(prepared.json)).toEqual({ kind: 'ok', project: prepared.project });
  });

  it('rejects invalid runtime state instead of writing a project that cannot reopen', () => {
    const project = {
      ...createProject(),
      workspace: { ...createProject().workspace, width: Number.NaN },
    } as Project;

    expect(prepareProjectForPersistence(project)).toEqual({
      kind: 'invalid',
      reason: 'missing or invalid `workspace.width`',
    });
  });
});
